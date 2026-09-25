import { beforeAll, beforeEach, afterAll, describe, it, expect } from "vitest";
process.env.MONGO_DB = "resonance_catalog_test_" + process.pid;
const { collection, initDb, closeDb, db } = await import(
  "../apps/api/src/db.js"
);
const { seedData, seedId } = await import("../apps/api/src/seed-data.js");
const { originalDemoCatalog: demoCatalog } = await import(
  "../apps/api/src/demo-catalog.js"
);
const { refreshDemoCatalog } = await import(
  "../apps/api/src/refresh-demo-catalog.js"
);

describe.skipIf(process.env.INTEGRATION !== "1")(
  "safe demo catalog refresh",
  () => {
    beforeAll(initDb);
    beforeEach(async () => {
      for (const name of [
        "songs",
        "artists",
        "albums",
        "genres",
        "playlists",
        "playback_sessions",
        "sync_outbox",
        "app_state",
      ])
        await collection(name).deleteMany({});
      const data = seedData(false, "", new Date(), demoCatalog);
      const oldIds = new Map(
        data.songs.map((song, i) => [song.songId, seedId("real-song:" + i)]),
      );
      for (const name of ["artists", "albums", "genres"] as const)
        await collection(name).insertMany(data[name]);
      await collection("songs").insertMany(
        data.songs.map((song, i) => ({
          ...song,
          songId: seedId("real-song:" + i),
          title: i === 10 ? "Faded" : "Original recording " + i,
          media: { provider: "youtube", videoId: demoCatalog[i].legacyVideoId },
        })),
      );
      const playlist = data.playlists[0];
      playlist.tracks = playlist.tracks.map((t) => ({
        ...t,
        songId: oldIds.get(t.songId)!,
      }));
      // Repeated songs retain distinct entry identities and positions.
      playlist.tracks[1].songId = playlist.tracks[0].songId;
      await collection("playlists").insertOne(playlist);
      await collection("playback_sessions").insertOne({
        ...data.playback_sessions[0],
        songId: seedId("real-song:0"),
        mediaSnapshot: {
          provider: "youtube",
          videoId: demoCatalog[0].legacyVideoId,
        },
      });
    });
    afterAll(async () => {
      await db.dropDatabase();
      await closeDb();
    });

    it("replaces 14 songs atomically, preserves Faded/history/entry identities, and is idempotent", async () => {
      const faded = await collection("songs").findOne({
        songId: seedId("real-song:10"),
      });
      const history = await collection("playback_sessions").find({}).toArray();
      const before = (await collection("playlists").findOne({}))!;
      expect(await refreshDemoCatalog()).toEqual({
        insertedSongs: 14,
        retiredSongs: 14,
        updatedPlaylists: 1,
        replacedEntries: 6,
      });
      expect(
        await collection("songs").countDocuments({ status: "active" }),
      ).toBe(15);
      expect(
        await collection("songs").findOne({ songId: faded!.songId }),
      ).toEqual(faded);
      expect(await collection("playback_sessions").find({}).toArray()).toEqual(
        history,
      );
      expect(
        (await collection("songs").findOne({ songId: history[0].songId }))!
          .title,
      ).toBe("Original recording 0");
      const after = (await collection("playlists").findOne({}))!;
      expect(after.version).toBe(before.version + 1);
      expect(after.tracks.map(({ songId, ...entry }: any) => entry)).toEqual(
        before.tracks.map(({ songId, ...entry }: any) => entry),
      );
      expect(after.tracks[0].songId).toBe(after.tracks[1].songId);
      expect(
        (await collection("app_state").findOne({ _id: "commands" as any }))!
          .analytics,
      ).toBe(true);
      const tasks = await collection("sync_outbox").countDocuments();
      expect(await refreshDemoCatalog()).toEqual({
        insertedSongs: 0,
        retiredSongs: 0,
        updatedPlaylists: 0,
        replacedEntries: 0,
      });
      expect(await collection("sync_outbox").countDocuments()).toBe(tasks);
    });

    it("rolls back all changes if a replacement video was already imported under another identity", async () => {
      const song = seedData(false, "", new Date(), demoCatalog).songs[5];
      await collection("songs").insertOne({
        ...song,
        songId: seedId("custom-import"),
      });
      const before = await collection("songs").find({}).toArray();
      await expect(refreshDemoCatalog()).rejects.toThrow();
      expect(await collection("songs").find({}).toArray()).toEqual(before);
      expect(await collection("sync_outbox").countDocuments()).toBe(0);
    });

    it("refuses to overwrite a manually replaced original video", async () => {
      await collection("songs").updateOne(
        { songId: seedId("real-song:0") },
        { $set: { "media.videoId": "abcdefghijk" } },
      );
      await expect(refreshDemoCatalog()).rejects.toThrow("customized");
      expect(await collection("songs").countDocuments()).toBe(15);
    });
  },
);
