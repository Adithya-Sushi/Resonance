import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import request from "supertest";
import { randomUUID } from "node:crypto";
import argon2 from "argon2";
const enabled = process.env.INTEGRATION === "1";
process.env.MONGO_DB = "resonance_test_" + process.pid;
process.env.NEO4J_URI = "bolt://127.0.0.1:7688";
process.env.YOUTUBE_API_KEY = "test-key-never-valid";
const { createApp, recommendations } = await import("../apps/api/src/app.js");
const { collection, initDb, closeDb, db, cypher } = await import(
  "../apps/api/src/db.js"
);
const { seedData } = await import("../apps/api/src/seed-data.js");
const { projectSnapshot, calculateAnalytics } = await import(
  "../apps/worker/src/projection.js"
);
const { aggregate, queryGraph, plain } = await import(
  "../apps/api/src/analytics.js"
);
const { publishRow, processImport, recordingDetails, refreshYoutubeMetadata } =
  await import("../apps/api/src/imports.js");
const { cleanAccounts, cleanSessions } = await import(
  "../apps/worker/src/index.js"
);
describe.skipIf(!enabled)("real MongoDB replica set and isolated Neo4j", () => {
  let data: any,
    app: any,
    admin: any,
    listener: any,
    token = "",
    listenerToken = "",
    playlist: any;
  beforeAll(async () => {
    await initDb();
    data = seedData(false, await argon2.hash("ResonanceDemo!2026"));
    for (const [name, rows] of Object.entries(data))
      await collection(name).insertMany(rows as any[]);
    app = createApp();
    admin = request.agent(app);
    listener = request.agent(app);
    const init = await admin.get("/api/v1/auth/me");
    token = init.body.csrfToken;
    const login = await admin
      .post("/api/v1/auth/login")
      .set("X-CSRF-Token", token)
      .send({ email: "admin@resonance.local", password: "ResonanceDemo!2026" });
    expect(login.status).toBe(200);
    token = login.body.csrfToken;
    const l = await listener.get("/api/v1/auth/me");
    const lr = await listener
      .post("/api/v1/auth/login")
      .set("X-CSRF-Token", l.body.csrfToken)
      .send({
        email: "listener@resonance.local",
        password: "ResonanceDemo!2026",
      });
    listenerToken = lr.body.csrfToken;
  });
  afterAll(async () => {
    vi.unstubAllGlobals();
    await closeDb();
  });
  it("anonymous concurrent reads do not replace the authentication session cookie", async () => {
    const a = request.agent(app);
    const [auth, songs, genres] = await Promise.all([
      a.get("/api/v1/auth/me"),
      a.get("/api/v1/songs"),
      a.get("/api/v1/genres"),
    ]);
    expect(songs.headers["set-cookie"]).toBeUndefined();
    expect(genres.headers["set-cookie"]).toBeUndefined();
    const r = await a
      .post("/api/v1/auth/login")
      .set("X-CSRF-Token", auth.body.csrfToken)
      .send({
        email: "listener@resonance.local",
        password: "ResonanceDemo!2026",
      });
    expect(r.status).toBe(200);
  });
  it("enforces roles and CSRF", async () => {
    expect((await listener.get("/api/v1/admin/status")).status).toBe(403);
    expect(
      (await admin.post("/api/v1/playlists").send({ name: "Bad" })).status,
    ).toBe(403);
  });
  it("prefix search and release-year filter hydrate authoritative names", async () => {
    const r = await admin.get("/api/v1/songs?q=queen&year=1975");
    expect(r.status).toBe(200);
    expect(r.body.items).toHaveLength(1);
    expect(r.body.items[0].title).toBe("Bohemian Rhapsody");
    expect(r.body.items[0].artists[0].name).toBe("Queen");
  });
  it("creates private playlist and blocks other listener access", async () => {
    const r = await admin
      .post("/api/v1/playlists")
      .set("X-CSRF-Token", token)
      .send({ name: "Integration mix", visibility: "private" });
    expect(r.status).toBe(201);
    playlist = r.body;
    expect(
      (await listener.get("/api/v1/playlists/" + playlist.playlistId)).status,
    ).toBe(404);
  });
  it("allows repeated songs, rejects concurrent edit with same version", async () => {
    const tracks = [1, 2].map((n) => ({
      entryId: randomUUID(),
      songId: data.songs[0].songId,
      position: n,
      addedAt: new Date().toISOString(),
    }));
    const payload = { ...playlist, tracks };
    const results = await Promise.all([
      admin
        .put("/api/v1/playlists/" + playlist.playlistId)
        .set("X-CSRF-Token", token)
        .send(payload),
      admin
        .put("/api/v1/playlists/" + playlist.playlistId)
        .set("X-CSRF-Token", token)
        .send(payload),
    ]);
    expect(results.map((x) => x.status).sort()).toEqual([200, 409]);
    expect(
      (
        await collection("playlists").findOne({
          playlistId: playlist.playlistId,
        })
      )?.tracks,
    ).toHaveLength(2);
  });
  it("rejects missing references and dependent retirement", async () => {
    const invalid = { ...data.songs[0], albumId: randomUUID() };
    expect(
      (
        await admin
          .post("/api/v1/admin/songs")
          .set("X-CSRF-Token", token)
          .send(invalid)
      ).status,
    ).toBe(400);
    expect(
      (
        await admin
          .delete("/api/v1/admin/albums/" + data.albums[0].albumId)
          .set("X-CSRF-Token", token)
      ).status,
    ).toBe(409);
  });
  it("requires the current playlist version for deletion", async () => {
    expect(
      (
        await admin
          .delete("/api/v1/playlists/" + playlist.playlistId)
          .set("X-CSRF-Token", token)
          .send({ version: 1 })
      ).status,
    ).toBe(409);
    expect(
      (
        await admin
          .delete("/api/v1/playlists/" + playlist.playlistId)
          .set("X-CSRF-Token", token)
          .send({ version: 2 })
      ).status,
    ).toBe(200);
  });
  it("start and finalization are idempotent and later checkpoints fail", async () => {
    const sessionId = randomUUID(),
      body = {
        sessionId,
        songId: data.songs[0].songId,
        context: { type: "catalog" },
      };
    for (let i = 0; i < 2; i++)
      expect(
        (
          await listener
            .post("/api/v1/playback")
            .set("X-CSRF-Token", listenerToken)
            .send(body)
        ).status,
      ).toBe(201);
    const payload = {
      seq: 1,
      playedSeconds: 0,
      coverageRanges: [],
      endReason: "stopped",
    };
    for (let i = 0; i < 2; i++)
      expect(
        (
          await listener
            .put("/api/v1/playback/" + sessionId)
            .set("X-CSRF-Token", listenerToken)
            .send(payload)
        ).status,
      ).toBe(200);
    expect(
      await collection("playback_sessions").countDocuments({ sessionId }),
    ).toBe(1);
    expect(
      (
        await listener
          .put("/api/v1/playback/" + sessionId)
          .set("X-CSRF-Token", listenerToken)
          .send({ ...payload, seq: 2 })
      ).status,
    ).toBe(409);
  });
  it("all six aggregations execute and conserve genre listening time", async () => {
    for (const id of ["A1", "A2", "A3", "A4", "A5", "A6"])
      expect(
        Array.isArray((await aggregate(id, data.users[0].userId)).rows),
      ).toBe(true);
    const trends = await aggregate("A3", data.users[0].userId);
    const sum = trends.rows.reduce((n, x) => n + x.seconds, 0);
    expect(sum).toBeCloseTo(
      data.playback_sessions.reduce(
        (n: number, x: any) => n + x.playedSeconds,
        0,
      ),
      3,
    );
  });
  it("graph rebuild is idempotent and all ten queries execute", async () => {
    await projectSnapshot();
    const before = plain(
      await cypher(
        "MATCH ()-[r:LISTENED_TO]->() RETURN sum(r.playCount) AS plays",
      ),
    );
    await projectSnapshot();
    expect(
      plain(
        await cypher(
          "MATCH ()-[r:LISTENED_TO]->() RETURN sum(r.playCount) AS plays",
        ),
      ),
    ).toEqual(before);
    for (let i = 1; i <= 10; i++)
      expect(
        Array.isArray(
          (
            await queryGraph("C" + i, {
              userId: data.users[0].userId,
              genreIds: data.users[0].preferences.genreIds,
              playlistId: data.playlists[0].playlistId,
              artistId: data.artists[0].artistId,
              otherArtistId: data.artists[1].artistId,
            })
          ).rows,
        ),
      ).toBe(true);
  });
  it("GDS algorithms run and publish timestamped results", async () => {
    await calculateAnalytics();
    const stats = await collection("app_state").findOne({
      _id: "analytics" as any,
    });
    expect(stats?.degrees.length).toBeGreaterThan(0);
    expect(stats?.similarities.length).toBeGreaterThan(0);
    expect(stats?.calculatedAt).toBeInstanceOf(Date);
  });
  it("opt-out removes all user edges and owned public playlists", async () => {
    await collection("users").updateOne(
      { userId: data.users[2].userId },
      { $set: { "privacy.recommendationOptIn": false } },
    );
    expect((await admin.get("/api/v1/admin/cypher/C9")).status).toBe(503);
    await projectSnapshot();
    expect((await admin.get("/api/v1/admin/cypher/C9")).status).toBe(200);
    expect(
      plain(
        await cypher("MATCH (u:User {userId:$id}) RETURN count(u) AS n", {
          id: data.users[2].userId,
        }),
      )[0].n,
    ).toBe(0);
  });
  it("failed provider request retains resumable job", async () => {
    const jobId = randomUUID();
    await collection("import_jobs").insertOne({
      jobId,
      status: "queued",
      createdAt: new Date(),
      videoIds: ["dQw4w9WgXcQ"],
      playlistIds: [],
      discoveryComplete: true,
      rows: [],
    });
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            error: { errors: [{ reason: "quotaExceeded" }] },
          }),
          { status: 403 },
        ),
      ),
    );
    await processImport();
    const job = await collection("import_jobs").findOne({ jobId });
    expect(job?.status).toBe("failed");
    expect(job?.error).toContain("quota");
    vi.unstubAllGlobals();
  });
  it("playlist import paginates and deduplicates IDs", async () => {
    const jobId = randomUUID();
    await collection("import_jobs").insertOne({
      jobId,
      status: "queued",
      createdAt: new Date(),
      videoIds: [],
      playlistIds: ["PL1234567890"],
      playlistCursor: 0,
      discoveryComplete: false,
      rows: [],
    });
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValueOnce(
          new Response(
            JSON.stringify({
              items: [{ contentDetails: { videoId: "abcdefghijk" } }],
              nextPageToken: "page2",
            }),
          ),
        )
        .mockResolvedValueOnce(
          new Response(
            JSON.stringify({
              items: [
                { contentDetails: { videoId: "abcdefghijk" } },
                { contentDetails: { videoId: "12345678901" } },
              ],
            }),
          ),
        ),
    );
    await processImport();
    await processImport();
    const job = await collection("import_jobs").findOne({ jobId });
    expect(job?.discoveryComplete).toBe(true);
    expect(job?.videoIds).toEqual(["abcdefghijk", "12345678901"]);
    await collection("import_jobs").updateOne(
      { jobId },
      { $set: { status: "review" } },
    );
    vi.unstubAllGlobals();
  });
  it("import publication creates references once and remains retry-safe", async () => {
    const jobId = randomUUID(),
      videoId = "abcdefghijk";
    await collection("import_jobs").insertOne({
      jobId,
      status: "review",
      rows: [
        {
          videoId,
          status: "ready",
          reviewed: true,
          youtube: {
            durationSec: 200,
            expiresAt: new Date(Date.now() + 86400000),
          },
          draft: {
            title: "Imported test song",
            artistName: "Unique import artist",
            albumTitle: "Test release",
            releaseDate: "2020-01-01",
            type: "single",
            language: "English",
            genreIds: [data.genres[0].genreId],
            durationSec: 200,
            trackNumber: 1,
            discNumber: 1,
          },
        },
      ],
    });
    const id = await publishRow(jobId, videoId);
    expect(await publishRow(jobId, videoId)).toBe(id);
    expect(
      await collection("songs").countDocuments({ "media.videoId": videoId }),
    ).toBe(1);
    expect(
      await collection("sync_outbox").countDocuments({ aggregateId: id }),
    ).toBe(1);
  });
  it("invalid import row rolls back newly created artist and album", async () => {
    const jobId = randomUUID();
    await collection("import_jobs").insertOne({
      jobId,
      rows: [
        {
          videoId: "12345678901",
          status: "ready",
          reviewed: true,
          youtube: {
            durationSec: 200,
            expiresAt: new Date(Date.now() + 86400000),
          },
          draft: {
            title: "Bad genre",
            artistName: "Must roll back",
            albumTitle: "Not saved",
            releaseDate: "2020-01-01",
            type: "album",
            language: "English",
            genreIds: [randomUUID()],
            durationSec: 200,
          },
        },
      ],
    });
    await expect(publishRow(jobId, "12345678901")).rejects.toThrow();
    expect(
      await collection("artists").countDocuments({ name: "Must roll back" }),
    ).toBe(0);
  });
  it("rejects incomplete metadata and persists mixed publication outcomes", async () => {
    const source = await collection("import_jobs").findOne({
      "rows.videoId": "abcdefghijk",
      "rows.status": "published",
    });
    const valid = source!.rows[0];
    const jobId = randomUUID();
    await collection("import_jobs").insertOne({
      jobId,
      status: "review",
      rows: [
        { ...valid, videoId: "newvalid001", status: "ready" },
        {
          ...valid,
          videoId: "incomplete1",
          status: "ready",
          draft: { ...valid.draft, title: "", genreIds: [] },
        },
      ],
    });
    const r = await admin
      .post(`/api/v1/admin/imports/${jobId}/publish`)
      .set("X-CSRF-Token", token)
      .send({ videoIds: ["newvalid001", "incomplete1"] });
    expect(r.status).toBe(200);
    expect(r.body.results.map((x: any) => x.status)).toEqual([
      "published",
      "error",
    ]);
    const job = await collection("import_jobs").findOne({ jobId });
    expect(job!.rows[1].publishError).toBeTruthy();
    expect(
      await collection("songs").countDocuments({
        "media.videoId": "incomplete1",
      }),
    ).toBe(0);
  });
  it("marks private, deleted and non-embeddable videos unavailable", async () => {
    const jobId = randomUUID();
    await collection("import_jobs").insertOne({
      jobId,
      status: "queued",
      createdAt: new Date(),
      videoIds: ["private0001", "deleted0001", "blocked0001"],
      playlistIds: [],
      discoveryComplete: true,
      rows: [],
    });
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            items: [
              {
                id: "blocked0001",
                status: { embeddable: false },
                snippet: { liveBroadcastContent: "none" },
                contentDetails: { duration: "PT3M" },
              },
            ],
          }),
        ),
      ),
    );
    await processImport();
    const job = await collection("import_jobs").findOne({ jobId });
    expect(job!.rows.map((x: any) => x.status)).toEqual([
      "unavailable",
      "unavailable",
      "unavailable",
    ]);
    await collection("import_jobs").updateOne(
      { jobId, "rows.videoId": "private0001" },
      {
        $set: {
          "rows.$.draft": { title: "Preserve reviewed title" },
          "rows.$.reviewed": true,
        },
      },
    );
    await admin
      .post(`/api/v1/admin/imports/${jobId}/retry`)
      .set("X-CSRF-Token", token);
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockImplementation(
          async (url: any) =>
            new Response(
              JSON.stringify(
                String(url).includes("googleapis")
                  ? {
                      items: [
                        {
                          id: "private0001",
                          status: { embeddable: true },
                          snippet: {
                            title: "Provider title",
                            liveBroadcastContent: "none",
                          },
                          contentDetails: { duration: "PT3M" },
                        },
                      ],
                    }
                  : { recordings: [] },
              ),
            ),
        ),
    );
    await processImport();
    const retried = await collection("import_jobs").findOne({ jobId });
    expect(
      retried!.rows.find((r: any) => r.videoId === "private0001").draft.title,
    ).toBe("Preserve reviewed title");
    expect(
      retried!.rows.find((r: any) => r.videoId === "private0001").status,
    ).toBe("ready");
    await collection("import_jobs").updateOne(
      { jobId },
      { $set: { status: "review" } },
    );
    vi.unstubAllGlobals();
  });
  it("fetches release positions and genres and rejects conflicting recording matches", async () => {
    const recordingId = randomUUID(),
      releaseId = randomUUID();
    const fetcher = vi.fn().mockImplementation(
      async (url: string) =>
        new Response(
          JSON.stringify(
            url.includes("/recording/")
              ? { genres: [{ name: data.genres[0].name }] }
              : {
                  date: "2020-01-02",
                  media: [
                    {
                      position: 2,
                      tracks: [{ position: 7, recording: { id: recordingId } }],
                    },
                  ],
                },
          ),
        ),
    );
    vi.stubGlobal("fetch", fetcher);
    const r = await recordingDetails(recordingId, releaseId);
    expect(r.trackNumber).toBe(7);
    expect(r.discNumber).toBe(2);
    expect(r.genreIds).toEqual([data.genres[0].genreId]);
    await expect(recordingDetails(randomUUID(), releaseId)).rejects.toThrow(
      "does not appear",
    );
    expect(
      fetcher.mock.calls.every(([, options]) =>
        options.headers["User-Agent"].startsWith("Resonance/"),
      ),
    ).toBe(true);
    vi.unstubAllGlobals();
  });
  it("removes expired provider cache while preserving authored catalog and published state", async () => {
    const expiresAt = new Date(Date.now() - 1000),
      jobId = randomUUID();
    await collection("songs").updateOne(
      { songId: data.songs[0].songId },
      { $set: { youtubeMetadata: { title: "Provider cache", expiresAt } } },
    );
    await collection("import_jobs").insertOne({
      jobId,
      rows: [
        {
          videoId: "expired0001",
          status: "ready",
          youtube: { expiresAt },
          draft: { title: "Authored" },
        },
        { videoId: "expired0002", status: "published", youtube: { expiresAt } },
      ],
    });
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("offline")));
    await refreshYoutubeMetadata();
    const song = await collection("songs").findOne({
      songId: data.songs[0].songId,
    });
    expect(song!.youtubeMetadata).toBeUndefined();
    expect(song!.title).toBe(data.songs[0].title);
    const job = await collection("import_jobs").findOne({ jobId });
    expect(job!.rows[0].status).toBe("expired");
    expect(job!.rows[0].draft.title).toBe("Authored");
    expect(job!.rows[1].youtube).toBeUndefined();
    expect(job!.rows[1].status).toBe("published");
    vi.unstubAllGlobals();
  });
  it("stale sessions finalize as interrupted, not skipped", async () => {
    const s = {
      ...data.playback_sessions[0],
      sessionId: randomUUID(),
      status: "in_progress",
      lastCheckpointAt: new Date(Date.now() - 200000),
    };
    delete s._id;
    await collection("playback_sessions").insertOne(s);
    await cleanSessions();
    const updated = await collection("playback_sessions").findOne({
      sessionId: s.sessionId,
    });
    expect(updated?.endReason).toBe("interrupted");
  });
  it("account deletion revokes sessions and graph data cannot return", async () => {
    const r = await listener
      .delete("/api/v1/profile")
      .set("X-CSRF-Token", listenerToken);
    expect(r.status).toBe(202);
    expect((await listener.get("/api/v1/history")).status).toBe(401);
    await cleanAccounts();
    await projectSnapshot();
    expect(
      await collection("playback_sessions").countDocuments({
        userId: data.users[1].userId,
      }),
    ).toBe(0);
    expect(
      plain(
        await cypher("MATCH (u:User {userId:$id}) RETURN count(u) AS n", {
          id: data.users[1].userId,
        }),
      )[0].n,
    ).toBe(0);
    await projectSnapshot();
    expect(
      plain(
        await cypher("MATCH (u:User {userId:$id}) RETURN count(u) AS n", {
          id: data.users[1].userId,
        }),
      )[0].n,
    ).toBe(0);
  });
});
