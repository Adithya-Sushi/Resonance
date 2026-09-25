import { beforeAll, beforeEach, afterAll, describe, it, expect } from "vitest";
process.env.MONGO_DB = "resonance_expansion_test_" + process.pid;
const { collection, initDb, closeDb, db } = await import(
  "../apps/api/src/db.js"
);
const { seedData, seedId } = await import("../apps/api/src/seed-data.js");
const { originalDemoCatalog, demoCatalog } = await import(
  "../apps/api/src/demo-catalog.js"
);
const { expandDemoCatalog } = await import(
  "../apps/api/src/expand-demo-catalog.js"
);
const { catalogAdditions } = await import(
  "../apps/api/src/catalog-additions.js"
);

describe.skipIf(process.env.INTEGRATION !== "1")(
  "additive catalog expansion",
  () => {
    beforeAll(initDb);
    beforeEach(async () => {
      for (const name of [
        "users",
        "songs",
        "artists",
        "albums",
        "genres",
        "playlists",
        "follows",
        "playback_sessions",
        "sync_outbox",
        "app_state",
      ])
        await collection(name).deleteMany({});
      const data = seedData(false, "hash", new Date(), originalDemoCatalog);
      for (const [name, rows] of Object.entries(data))
        await collection(name).insertMany(rows);
    });
    afterAll(async () => {
      await db.dropDatabase();
      await closeDb();
    });

    it("adds 55 unique songs with several genres, preserves user data, and reruns without changes", async () => {
      const before: Record<string, any[]> = {};
      for (const name of [
        "users",
        "songs",
        "playlists",
        "follows",
        "playback_sessions",
      ])
        before[name] = await collection(name)
          .find({})
          .sort({ _id: 1 })
          .toArray();
      expect((await expandDemoCatalog()).songs).toBe(55);
      expect(
        await collection("songs").countDocuments({ status: "active" }),
      ).toBe(70);
      for (const [name, rows] of Object.entries(before))
        expect(
          await collection(name)
            .find({ _id: { $in: rows.map((r) => r._id) } })
            .sort({ _id: 1 })
            .toArray(),
        ).toEqual(rows);
      expect(
        new Set(demoCatalog.flatMap((r) => r.genres)).size,
      ).toBeGreaterThanOrEqual(8);
      expect(new Set(demoCatalog.map((r) => r.videoId)).size).toBe(70);
      const tasks = await collection("sync_outbox").countDocuments();
      expect(await expandDemoCatalog()).toEqual({
        genres: 0,
        artists: 0,
        albums: 0,
        songs: 0,
        updatedArtists: 0,
      });
      expect(await collection("sync_outbox").countDocuments()).toBe(tasks);
    });

    it("adds only the latest 20 songs to an existing 50-song catalog", async () => {
      const firstBatch = seedData(false, "hash", new Date(), [
        ...originalDemoCatalog,
        ...catalogAdditions,
      ]);
      for (const [name, id] of [
        ["genres", "genreId"],
        ["artists", "artistId"],
        ["albums", "albumId"],
        ["songs", "songId"],
      ]) {
        for (const row of firstBatch[
          name as keyof typeof firstBatch
        ] as any[]) {
          await collection(name).replaceOne({ [id]: row[id] }, row, {
            upsert: true,
          });
        }
      }
      const before = await collection("songs")
        .find({})
        .sort({ songId: 1 })
        .toArray();
      expect(before).toHaveLength(50);
      const result = await expandDemoCatalog();
      expect(result.songs).toBe(20);
      expect(result.albums).toBe(20);
      expect(await collection("songs").countDocuments()).toBe(70);
      expect(
        await collection("songs")
          .find({ songId: { $in: before.map((s) => s.songId) } })
          .sort({ songId: 1 })
          .toArray(),
      ).toEqual(before);
      expect((await expandDemoCatalog()).songs).toBe(0);
    });

    it("rolls back if a new video already exists under an unrelated catalog identity", async () => {
      await collection("songs").insertOne({
        ...seedData().songs[20],
        songId: seedId("manual-import"),
      });
      const before = await collection("artists").countDocuments();
      await expect(expandDemoCatalog()).rejects.toThrow();
      expect(await collection("songs").countDocuments()).toBe(16);
      expect(await collection("artists").countDocuments()).toBe(before);
      expect(await collection("sync_outbox").countDocuments()).toBe(0);
    });
  },
);
