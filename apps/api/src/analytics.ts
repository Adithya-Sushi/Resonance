import type { Document } from "mongodb";
import { collection, cypher } from "./db.js";
export const aggregateNames: Record<string, string> = {
  A1: "Top songs",
  A2: "Personal listening summary",
  A3: "Weekly genre trends",
  A4: "Playlist engagement",
  A5: "Artist catalog coverage",
  A6: "Monthly active listeners",
};
export function pipelines(
  id: string,
  userId: string,
  from: Date,
  to: Date,
): Document[] {
  const period = {
    $match: { status: "finalized", startedAt: { $gte: from, $lt: to } },
  };
  const qualify = {
    $set: {
      qualified: {
        $gte: [
          "$playedSeconds",
          { $min: [30, { $multiply: ["$durationSecSnapshot", 0.5] }] },
        ],
      },
    },
  };
  const names = (
    name: string,
    localField: string,
    foreignField: string,
    as: string,
  ) => ({ $lookup: { from: name, localField, foreignField, as } });
  const p: Record<string, Document[]> = {
    A1: [
      period,
      qualify,
      { $match: { qualified: true } },
      {
        $group: {
          _id: "$songId",
          plays: { $sum: 1 },
          listeners: { $addToSet: "$userId" },
        },
      },
      { $set: { listeners: { $size: "$listeners" } } },
      names("songs", "_id", "songId", "song"),
      {
        $set: {
          name: { $ifNull: [{ $first: "$song.title" }, "Unavailable song"] },
        },
      },
      { $unset: "song" },
      { $sort: { plays: -1, _id: 1 } },
      { $limit: 50 },
    ],
    A2: [
      period,
      { $match: { userId } },
      qualify,
      {
        $group: {
          _id: null,
          playedSeconds: { $sum: "$playedSeconds" },
          qualifiedPlays: { $sum: { $cond: ["$qualified", 1, 0] } },
          skips: { $sum: { $cond: [{ $eq: ["$endReason", "skip"] }, 1, 0] } },
          completionRatio: { $avg: "$completionRatio" },
          sessions: { $sum: 1 },
        },
      },
    ],
    A3: [
      period,
      names("songs", "songId", "songId", "song"),
      { $unwind: "$song" },
      {
        $set: {
          seconds: { $divide: ["$playedSeconds", { $size: "$song.genreIds" }] },
        },
      },
      { $unwind: "$song.genreIds" },
      {
        $group: {
          _id: {
            week: {
              $dateTrunc: { date: "$startedAt", unit: "week", timezone: "UTC" },
            },
            genreId: "$song.genreIds",
          },
          seconds: { $sum: "$seconds" },
        },
      },
      names("genres", "_id.genreId", "genreId", "genre"),
      { $set: { name: { $first: "$genre.name" } } },
      { $unset: "genre" },
      { $sort: { "_id.week": 1 } },
    ],
    A4: [
      period,
      { $match: { "context.type": "playlist" } },
      {
        $group: {
          _id: "$context.playlistId",
          sessions: { $sum: 1 },
          playedSeconds: { $sum: "$playedSeconds" },
        },
      },
      names("playlists", "_id", "playlistId", "playlist"),
      {
        $set: {
          name: {
            $ifNull: [{ $first: "$playlist.name" }, "Unavailable playlist"],
          },
        },
      },
      { $unset: "playlist" },
      { $sort: { sessions: -1 } },
    ],
    A5: [
      { $unwind: "$artistCredits" },
      {
        $group: {
          _id: "$artistCredits.artistId",
          creditedSongs: { $sum: 1 },
          albumIds: { $addToSet: "$albumId" },
          creditBasedDuration: { $sum: "$durationSec" },
        },
      },
      { $set: { albums: { $size: "$albumIds" } } },
      names("artists", "_id", "artistId", "artist"),
      { $set: { name: { $first: "$artist.name" } } },
      { $unset: ["artist", "albumIds"] },
    ],
    A6: [
      period,
      qualify,
      { $match: { qualified: true } },
      {
        $group: {
          _id: {
            month: {
              $dateToString: {
                date: "$startedAt",
                format: "%Y-%m",
                timezone: "UTC",
              },
            },
            userId: "$userId",
          },
        },
      },
      { $group: { _id: "$_id.month", listeners: { $sum: 1 } } },
      { $sort: { _id: 1 } },
    ],
  };
  return p[id] || [];
}
export async function aggregate(
  id: string,
  userId: string,
  from = new Date(0),
  to = new Date(),
) {
  const pipeline = pipelines(id, userId, from, to);
  if (!pipeline.length) throw new Error("Unknown aggregation");
  return {
    id,
    name: aggregateNames[id],
    calculatedAt: new Date(),
    scope: "Application listening activity; UTC session-start attribution",
    rows: await collection(id === "A5" ? "songs" : "playback_sessions")
      .aggregate(pipeline)
      .toArray(),
  };
}
export const queries: Record<string, { name: string; query: string }> = {
  C1: {
    name: "Recent distinct songs",
    query:
      "MATCH (:User {userId:$userId})-[l:LISTENED_TO]->(s:Song) RETURN s.songId AS songId,l.lastPlayedAt AS lastPlayedAt ORDER BY lastPlayedAt DESC LIMIT 50",
  },
  C2: {
    name: "Most-listened artists (full credit)",
    query:
      "MATCH (:User {userId:$userId})-[l:LISTENED_TO]->(:Song)-[:PERFORMED_BY]->(a:Artist) RETURN a.artistId AS artistId,a.name AS name,sum(l.totalSeconds) AS seconds ORDER BY seconds DESC LIMIT 50",
  },
  C3: {
    name: "Discover followed artists",
    query:
      'MATCH (u:User {userId:$userId})-[:FOLLOWS]->(:Artist)<-[:PERFORMED_BY]-(s:Song {status:"active"}) WHERE NOT EXISTS { MATCH (u)-[l:LISTENED_TO]->(s) WHERE l.playCount>0 } RETURN DISTINCT s.songId AS songId ORDER BY songId LIMIT 50',
  },
  C4: {
    name: "Jaccard listener overlap",
    query:
      'MATCH (u:User {userId:$userId})-[a:LISTENED_TO]->(s:Song {status:"active"})<-[b:LISTENED_TO]-(v:User) WHERE a.affinity>0 AND b.affinity>0 AND u<>v WITH u,v,count(DISTINCT s) AS shared WHERE shared>=2 MATCH (u)-[x:LISTENED_TO]->(us:Song {status:"active"}) WHERE x.affinity>0 WITH u,v,shared,count(DISTINCT us) AS uc MATCH (v)-[y:LISTENED_TO]->(vs:Song {status:"active"}) WHERE y.affinity>0 WITH v,shared,uc,count(DISTINCT vs) AS vc RETURN v.userId AS userId,shared,toFloat(shared)/(uc+vc-shared) AS score ORDER BY score DESC,userId LIMIT 10',
  },
  C5: {
    name: "Similar listeners recommend",
    query:
      'UNWIND $neighbors AS neighbor MATCH (:User {userId:neighbor.userId})-[l:LISTENED_TO]->(s:Song {status:"active"}) WHERE l.affinity>0 AND NOT EXISTS { MATCH (:User {userId:$userId})-[own:LISTENED_TO]->(s) WHERE own.playCount>0 } RETURN s.songId AS songId,sum(neighbor.score*l.affinity) AS score ORDER BY score DESC,songId LIMIT 50',
  },
  C6: {
    name: "Shared listening genres",
    query:
      'MATCH (:User {userId:$userId})-[l:LISTENED_TO]->(:Song)-[:IN_GENRE]->(g:Genre)<-[:IN_GENRE]-(s:Song {status:"active"}) WHERE l.affinity>0 RETURN s.songId AS songId,count(DISTINCT g) AS sharedGenres ORDER BY sharedGenres DESC,songId LIMIT 50',
  },
  C7: {
    name: "Public playlist overlap",
    query:
      "MATCH (p:Playlist {playlistId:$playlistId})-[:CONTAINS]->(s:Song)<-[:CONTAINS]-(q:Playlist) WHERE p<>q WITH p,q,count(DISTINCT s) AS shared MATCH (p)-[:CONTAINS]->(a:Song) WITH p,q,shared,count(DISTINCT a) AS pc MATCH (q)-[:CONTAINS]->(b:Song) WITH q,shared,pc,count(DISTINCT b) AS qc RETURN q.playlistId AS playlistId,shared,toFloat(shared)/(pc+qc-shared) AS score ORDER BY score DESC,playlistId LIMIT 50",
  },
  C8: {
    name: "Artist paths (up to four hops)",
    query:
      "MATCH p=(a:Artist {artistId:$artistId})-[:PERFORMED_BY|IN_GENRE*1..4]-(b:Artist {artistId:$otherArtistId}) WHERE a<>b RETURN [n IN nodes(p) | coalesce(n.artistId,n.songId,n.genreId)] AS path LIMIT 10",
  },
  C9: {
    name: "Recent seven-day popularity",
    query:
      'MATCH (:User)-[l:LISTENED_TO]->(s:Song {status:"active"}) RETURN s.songId AS songId,sum(l.recentPlayCount) AS plays ORDER BY plays DESC,songId LIMIT 50',
  },
  C10: {
    name: "Preferred genre discovery",
    query:
      'MATCH (s:Song {status:"active"})-[:IN_GENRE]->(g:Genre) WHERE g.genreId IN $genreIds RETURN s.songId AS songId,count(DISTINCT g) AS matchedGenres ORDER BY matchedGenres DESC,songId LIMIT 50',
  },
};
export function plain(value: any): any {
  if (value?.toNumber) return value.toNumber();
  if (value?.toStandardDate) return value.toStandardDate().toISOString();
  if (Array.isArray(value)) return value.map(plain);
  if (value && typeof value === "object")
    return Object.fromEntries(
      Object.entries(value).map(([k, v]) => [k, plain(v)]),
    );
  return value;
}
export async function queryGraph(id: string, params: Record<string, any>) {
  const q = queries[id];
  if (!q) throw new Error("Unknown query");
  if (id === "C5")
    params = {
      ...params,
      neighbors: plain(await cypher(queries.C4.query, params)),
    };
  return {
    id,
    name: q.name,
    calculatedAt: new Date(),
    rows: plain(
      await cypher(q.query, {
        genreIds: [],
        playlistId: "",
        artistId: "",
        otherArtistId: "",
        ...params,
      }),
    ),
  };
}
