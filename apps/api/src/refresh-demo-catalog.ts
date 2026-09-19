import { collection, transaction, outbox } from "./db.js";
import { originalDemoCatalog as demoCatalog } from "./demo-catalog.js";
import { demoSongId, seedData, seedId } from "./seed-data.js";

/** Replace only the original demo videos, without resetting accounts or history. */
export async function refreshDemoCatalog() {
  const data = seedData(false, "", new Date(), demoCatalog);
  return transaction(async (session) => {
    const options = { session };
    const faded = await collection("songs").findOne(
      { songId: seedId("real-song:10"), "media.videoId": "60ItHLz5WEA" },
      options,
    );
    if (!faded)
      throw new Error(
        "This database does not contain the original playable demo catalog. Seed an empty database normally; never run this on fixtures.",
      );
    const replacements = new Map<string, string>();
    const originals = [];
    for (const [i, row] of demoCatalog.entries()) {
      if (i === 10) continue;
      const old = await collection("songs").findOne(
        { songId: seedId("real-song:" + i) },
        options,
      );
      if (!old) continue;
      if (
        old.media?.videoId !== row.legacyVideoId ||
        old.provenance?.catalog !== "curated-demo"
      )
        throw new Error(
          `Original demo song ${i} was customized; refusing to replace an unrelated video.`,
        );
      if (old.status === "active") originals.push(old);
      replacements.set(old.songId, demoSongId(i));
    }
    let insertedSongs = 0;
    for (const [name, id] of [
      ["genres", "genreId"],
      ["artists", "artistId"],
      ["albums", "albumId"],
      ["songs", "songId"],
    ] as const) {
      for (const row of data[name]) {
        const doc = row as Record<string, any>;
        const existing = await collection(name).findOne(
          { [id]: doc[id] },
          options,
        );
        if (existing) {
          if (existing.status !== "active")
            throw new Error(
              `Curated ${name} record ${doc[id]} is retired; review it before refreshing.`,
            );
          if (name === "songs" && existing.media?.videoId !== doc.media.videoId)
            throw new Error(`Curated song ${doc[id]} was customized.`);
          continue;
        }
        // A conflicting imported video aborts the whole transaction via the unique video index.
        await collection(name).insertOne(doc, options);
        await outbox(session, name, doc[id], doc.version);
        if (name === "songs") insertedSongs++;
      }
    }
    for (const old of originals) {
      await collection("songs").updateOne(
        { songId: old.songId, version: old.version },
        {
          $set: {
            status: "retired",
            updatedAt: new Date(),
            replacementSongId: replacements.get(old.songId),
          },
          $inc: { version: 1 },
        },
        options,
      );
      await outbox(session, "songs", old.songId, old.version + 1);
    }
    let updatedPlaylists = 0,
      replacedEntries = 0;
    const playlists = await collection("playlists")
      .find({ "tracks.songId": { $in: [...replacements.keys()] } }, options)
      .toArray();
    for (const playlist of playlists) {
      const tracks = playlist.tracks.map((entry: any) => {
        const songId = replacements.get(entry.songId);
        if (!songId) return entry;
        replacedEntries++;
        return { ...entry, songId };
      });
      await collection("playlists").updateOne(
        { playlistId: playlist.playlistId, version: playlist.version },
        {
          $set: { tracks, updatedAt: new Date() },
          $inc: { version: 1 },
        },
        options,
      );
      await outbox(
        session,
        "playlists",
        playlist.playlistId,
        playlist.version + 1,
        playlist.ownerUserId,
      );
      updatedPlaylists++;
    }
    if (insertedSongs || originals.length || updatedPlaylists) {
      // The existing single worker serializes graph reconciliation and analytics refresh.
      await collection("app_state").updateOne(
        { _id: "commands" as any },
        { $set: { rebuild: true, analytics: true } },
        { ...options, upsert: true },
      );
    }
    return {
      insertedSongs,
      retiredSongs: originals.length,
      updatedPlaylists,
      replacedEntries,
    };
  });
}
