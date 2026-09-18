import { randomUUID } from "node:crypto";
import {
  collection,
  transaction,
  graph,
  cypher,
  initGraph,
} from "../../api/src/db.js";
import { qualified } from "@resonance/shared";
import { plain } from "../../api/src/analytics.js";
export async function sourceSnapshot() {
  return transaction(async (s) => {
    const result: Record<string, any[]> = {};
    for (const name of [
      "users",
      "artists",
      "albums",
      "songs",
      "genres",
      "playlists",
      "follows",
      "playback_sessions",
    ])
      result[name] = await collection(name).find({}, { session: s }).toArray();
    return result;
  });
}
export function buildProjection(
  data: Record<string, any[]>,
  asOf = new Date(),
) {
  const users = data.users.filter(
    (u) => u.status === "active" && u.privacy.recommendationOptIn,
  );
  const userIds = new Set(users.map((u) => u.userId));
  const songIds = new Set(data.songs.map((s) => s.songId));
  const artistIds = new Set(data.artists.map((a) => a.artistId));
  const albumIds = new Set(data.albums.map((a) => a.albumId));
  const genreIds = new Set(data.genres.map((g) => g.genreId));
  const playlists = data.playlists.filter(
    (p) => p.visibility === "public" && userIds.has(p.ownerUserId),
  );
  const pairs = new Map<string, any>();
  const windowStart = new Date(+asOf - 7 * 86400000);
  for (const s of data.playback_sessions) {
    if (
      s.status !== "finalized" ||
      !userIds.has(s.userId) ||
      !songIds.has(s.songId)
    )
      continue;
    const key = s.userId + ":" + s.songId;
    let l = pairs.get(key);
    if (!l) {
      l = {
        userId: s.userId,
        songId: s.songId,
        playCount: 0,
        totalSeconds: 0,
        skipCount: 0,
        completionRate: 0,
        lastPlayedAt: new Date(0).toISOString(),
        affinity: 0,
        recentPlayCount: 0,
        recentWindowStart: windowStart.toISOString(),
        recentWindowEnd: asOf.toISOString(),
        sessions: 0,
      };
      pairs.set(key, l);
    }
    l.totalSeconds += s.playedSeconds;
    l.completionRate += s.completionRatio;
    l.sessions++;
    if (s.endReason === "skip") l.skipCount++;
    if (qualified(s.playedSeconds, s.durationSecSnapshot)) {
      l.playCount++;
      if (s.endReason !== "skip")
        l.affinity += s.playedSeconds / s.durationSecSnapshot / 3;
      if (
        +new Date(s.startedAt) >= +windowStart &&
        +new Date(s.startedAt) < +asOf
      )
        l.recentPlayCount++;
    }
    if (new Date(s.startedAt).toISOString() > l.lastPlayedAt)
      l.lastPlayedAt = new Date(s.startedAt).toISOString();
  }
  for (const l of pairs.values()) {
    l.completionRate /= l.sessions;
    l.affinity = Math.min(1, l.affinity);
    delete l.sessions;
  }
  const nodes = {
    User: users.map((u) => ({ userId: u.userId })),
    Artist: data.artists.map((a) => ({
      artistId: a.artistId,
      name: a.name,
      status: a.status,
      version: a.version,
    })),
    Album: data.albums.map((a) => ({
      albumId: a.albumId,
      title: a.title,
      releaseDate: new Date(a.releaseDate).toISOString(),
      status: a.status,
      version: a.version,
    })),
    Genre: data.genres.map((g) => ({
      genreId: g.genreId,
      name: g.name,
      status: g.status,
    })),
    Song: data.songs.map((s) => ({
      songId: s.songId,
      title: s.title,
      durationSec: s.durationSec,
      status: s.status,
      releaseYear: new Date(
        data.albums.find((a) => a.albumId === s.albumId)?.releaseDate || 0,
      ).getUTCFullYear(),
      version: s.version,
    })),
    Playlist: playlists.map((p) => ({
      playlistId: p.playlistId,
      name: p.name,
      visibility: p.visibility,
      version: p.version,
    })),
  };
  const edges: Record<string, any[]> = {
    LISTENED_TO: [...pairs.values()],
    FOLLOWS: data.follows
      .filter((f) => userIds.has(f.userId) && artistIds.has(f.artistId))
      .map((f) => ({
        userId: f.userId,
        artistId: f.artistId,
        followedAt: new Date(f.followedAt).toISOString(),
      })),
    CREATED: playlists.map((p) => ({
      userId: p.ownerUserId,
      playlistId: p.playlistId,
      createdAt: new Date(p.createdAt).toISOString(),
    })),
    CONTAINS: playlists.flatMap((p) =>
      p.tracks
        .filter((t: any) => songIds.has(t.songId))
        .map((t: any) => ({
          ...t,
          addedAt: new Date(t.addedAt).toISOString(),
          playlistId: p.playlistId,
        })),
    ),
    PERFORMED_BY: data.songs.flatMap((s) =>
      s.artistCredits
        .filter((a: any) => artistIds.has(a.artistId))
        .map((a: any) => ({
          songId: s.songId,
          artistId: a.artistId,
          role: a.role,
        })),
    ),
    IN_GENRE: data.songs.flatMap((s) =>
      s.genreIds
        .filter((g: string) => genreIds.has(g))
        .map((genreId: string) => ({ songId: s.songId, genreId })),
    ),
    RELEASED_ON: data.songs
      .filter((s) => albumIds.has(s.albumId))
      .map((s) => ({
        songId: s.songId,
        albumId: s.albumId,
        trackNumber: s.trackNumber,
        discNumber: s.discNumber,
      })),
  };
  return { nodes, edges, asOf, windowStart };
}
export async function projectSnapshot(asOf = new Date()) {
  const projection = buildProjection(await sourceSnapshot(), asOf);
  await initGraph();
  const session = graph.session();
  try {
    await session.executeWrite(
      async (tx) => {
        // Atomic full projection is intentional at classroom scale; only this worker writes Neo4j.
        await tx.run("MATCH (n) DETACH DELETE n");
        const keys: Record<string, string> = {
          User: "userId",
          Artist: "artistId",
          Album: "albumId",
          Song: "songId",
          Genre: "genreId",
          Playlist: "playlistId",
        };
        for (const [label, rows] of Object.entries(projection.nodes))
          await tx.run(`UNWIND $rows AS row CREATE (n:${label}) SET n = row`, {
            rows,
          });
        const mapping: Record<string, string[]> = {
          LISTENED_TO: ["User", "Song"],
          FOLLOWS: ["User", "Artist"],
          CREATED: ["User", "Playlist"],
          CONTAINS: ["Playlist", "Song"],
          PERFORMED_BY: ["Song", "Artist"],
          IN_GENRE: ["Song", "Genre"],
          RELEASED_ON: ["Song", "Album"],
        };
        for (const [rel, [a, b]] of Object.entries(mapping)) {
          const ka = keys[a],
            kb = keys[b];
          await tx.run(
            `UNWIND $rows AS row MATCH (a:${a} {${ka}:row.${ka}}),(b:${b} {${kb}:row.${kb}}) CREATE (a)-[r:${rel}]->(b) SET r = row`,
            { rows: projection.edges[rel] },
          );
        }
        await tx.run(
          "MATCH ()-[r:LISTENED_TO]->() SET r.lastPlayedAt=datetime(r.lastPlayedAt),r.recentWindowStart=datetime(r.recentWindowStart),r.recentWindowEnd=datetime(r.recentWindowEnd)",
        );
      },
      { timeout: 30000 },
    );
  } finally {
    await session.close();
  }
  await collection("app_state").updateOne(
    { _id: "projection" as any },
    {
      $set: {
        calculatedAt: new Date(),
        windowStart: projection.windowStart,
        windowEnd: asOf,
        eligibleUserIds: projection.nodes.User.map((u) => u.userId).sort(),
        nodes: Object.values(projection.nodes).reduce(
          (n, x) => n + x.length,
          0,
        ),
        relationships: Object.values(projection.edges).reduce(
          (n, x) => n + x.length,
          0,
        ),
      },
    },
    { upsert: true },
  );
  return projection;
}
export async function calculateAnalytics() {
  const projectedUsers = (
    await cypher("MATCH (u:User) RETURN u.userId AS userId")
  )
    .map((x) => x.userId as string)
    .sort();
  const suffix = randomUUID().replaceAll("-", "");
  const similarity = "similarity_" + suffix,
    degree = "degree_" + suffix;
  let similarities: any[] = [],
    degrees: any[] = [];
  try {
    const count = await cypher(
      'MATCH (u:User)-[l:LISTENED_TO]->(s:Song {status:"active"}) WHERE l.affinity>0 RETURN count(l) AS count',
    );
    if (Number(count[0]?.count) > 0) {
      await cypher(
        "CALL gds.graph.project.cypher($name,$nodes,$edges) YIELD graphName",
        {
          name: similarity,
          nodes:
            'MATCH (n) WHERE n:User OR (n:Song AND n.status="active") RETURN id(n) AS id',
          edges:
            'MATCH (u:User)-[l:LISTENED_TO]->(s:Song {status:"active"}) WHERE l.affinity>0 RETURN id(u) AS source,id(s) AS target',
        },
      );
      similarities = plain(
        await cypher(
          "CALL gds.nodeSimilarity.stream($name,{topK:10,similarityCutoff:0.001}) YIELD node1,node2,similarity RETURN gds.util.asNode(node1).userId AS userId,gds.util.asNode(node2).userId AS neighborId,similarity ORDER BY similarity DESC LIMIT 100",
          { name: similarity },
        ),
      );
    }
    const qc = await cypher(
      'MATCH (:User)-[l:LISTENED_TO]->(:Song {status:"active"}) WHERE l.playCount>0 RETURN count(l) AS count',
    );
    if (Number(qc[0]?.count) > 0) {
      await cypher(
        "CALL gds.graph.project.cypher($name,$nodes,$edges) YIELD graphName",
        {
          name: degree,
          nodes:
            'MATCH (n) WHERE n:User OR (n:Song AND n.status="active") RETURN id(n) AS id',
          edges:
            'MATCH (u:User)-[l:LISTENED_TO]->(s:Song {status:"active"}) WHERE l.playCount>0 RETURN id(s) AS source,id(u) AS target',
        },
      );
      degrees = plain(
        await cypher(
          "CALL gds.degree.stream($name) YIELD nodeId,score WITH gds.util.asNode(nodeId) AS n,score WHERE n:Song RETURN n.songId AS songId,n.title AS title,score AS distinctOptedInListeners ORDER BY distinctOptedInListeners DESC,songId LIMIT 50",
          { name: degree },
        ),
      );
    }
    const eligible = new Set(
      (
        await collection("users")
          .find({ status: "active", "privacy.recommendationOptIn": true })
          .toArray()
      ).map((x) => x.userId),
    );
    if (JSON.stringify([...eligible].sort()) !== JSON.stringify(projectedUsers))
      return;
    similarities = similarities.filter(
      (x) => eligible.has(x.userId) && eligible.has(x.neighborId),
    );
    await collection("app_state").updateOne(
      { _id: "analytics" as any },
      {
        $set: {
          calculatedAt: new Date(),
          scope: "Active opted-in listeners",
          eligibleUserIds: projectedUsers,
          similarities,
          degrees,
          algorithms: [
            "GDS Node Similarity (Jaccard)",
            "GDS Degree (Song → User)",
          ],
        },
      },
      { upsert: true },
    );
  } finally {
    for (const name of [similarity, degree])
      await cypher("CALL gds.graph.drop($name,false) YIELD graphName", {
        name,
      }).catch(() => {});
  }
}
