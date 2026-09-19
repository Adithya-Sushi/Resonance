import { collection, transaction, outbox } from "./db.js";
import { catalogAdditions } from "./catalog-additions.js";
import { additionalTwenty } from "./catalog-additions-20.js";
import { seedData } from "./seed-data.js";

/** Add the curated expansion without rewriting existing songs or user activity. */
export async function expandDemoCatalog() {
  const data = seedData(false, "", new Date(), [
    ...catalogAdditions,
    ...additionalTwenty,
  ]);
  return transaction(async (session) => {
    const counts = {
      genres: 0,
      artists: 0,
      albums: 0,
      songs: 0,
      updatedArtists: 0,
    };
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
          { session },
        );
        if (existing) {
          if (existing.status !== "active")
            throw new Error(
              `Review retired ${name} record ${doc[id]} before expanding.`,
            );
          if (name === "songs" && existing.media?.videoId !== doc.media.videoId)
            throw new Error(
              `Song ${doc[id]} was customized; not overwriting it.`,
            );
          if (name === "artists") {
            if (existing.name !== doc.name)
              throw new Error(
                `Artist ${doc[id]} was customized; review its identity.`,
              );
            const added = doc.genreIds.filter(
              (g: string) => !existing.genreIds.includes(g),
            );
            if (added.length) {
              await collection(name).updateOne(
                { [id]: doc[id] },
                {
                  $addToSet: { genreIds: { $each: added } },
                  $inc: { version: 1 },
                  $set: { updatedAt: new Date() },
                },
                { session },
              );
              await outbox(session, name, doc[id], existing.version + 1);
              counts.updatedArtists++;
            }
          }
          continue;
        }
        await collection(name).insertOne(doc, { session });
        await outbox(session, name, doc[id], doc.version);
        counts[name]++;
      }
    }
    if (Object.values(counts).some(Boolean))
      await collection("app_state").updateOne(
        { _id: "commands" as any },
        { $set: { rebuild: true, analytics: true } },
        { session, upsert: true },
      );
    return counts;
  });
}
