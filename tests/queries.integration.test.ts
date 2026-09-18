import { describe, it, expect, beforeAll, afterAll } from "vitest";
process.env.MONGO_DB = "resonance_queries_" + process.pid;
process.env.NEO4J_URI = "bolt://127.0.0.1:7688";
const { collection, initDb, closeDb, cypher } = await import(
  "../apps/api/src/db.js"
);
const { seedData } = await import("../apps/api/src/seed-data.js");
const { aggregate, queryGraph, plain } = await import(
  "../apps/api/src/analytics.js"
);
const { projectSnapshot, calculateAnalytics } = await import(
  "../apps/worker/src/projection.js"
);
const now = new Date("2026-09-18T00:00:00Z");
const data = seedData(true, "non-login-fixture", now);
const userId = data.users[0].userId;
const qualified = (s: any) =>
  s.playedSeconds >= Math.min(30, s.durationSecSnapshot / 2);
const sessions = data.playback_sessions;
const sum = (rows: any[], field: string) =>
  rows.reduce((n, r) => n + r[field], 0);
const params = {
  userId,
  genreIds: data.users[0].preferences.genreIds,
  playlistId: data.playlists[1].playlistId,
  artistId: data.artists[0].artistId,
  otherArtistId: data.artists[1].artistId,
};
const sorted = (xs: any[]) => [...xs].sort();
const heard = (id: string, positive = false) =>
  new Set(
    sessions
      .filter(
        (s) =>
          s.userId === id &&
          qualified(s) &&
          (!positive || s.endReason !== "skip"),
      )
      .map((s) => s.songId),
  );
const own = heard(userId),
  positive = heard(userId, true);
const overlap = (a: Set<string>, b: Set<string>) =>
  [...a].filter((x) => b.has(x)).length;
const neighbors = data.users
  .filter((u) => u.userId !== userId)
  .map((u) => {
    const theirs = heard(u.userId, true),
      shared = overlap(positive, theirs);
    return {
      userId: u.userId,
      shared,
      score: shared / (positive.size + theirs.size - shared),
    };
  })
  .filter((x) => x.shared >= 2)
  .sort((a, b) => b.score - a.score || a.userId.localeCompare(b.userId))
  .slice(0, 10);

describe.skipIf(process.env.INTEGRATION !== "1")(
  "exact PDF fixtures and independent query oracles",
  () => {
    beforeAll(async () => {
      await initDb();
      for (const [name, rows] of Object.entries(data))
        await collection(name).insertMany(rows);
      await projectSnapshot(now);
    });
    afterAll(async () => {
      await closeDb();
    });
    it("persists exactly 808 records, 228 nodes and 1,260 relationships", async () => {
      const counts = await Promise.all(
        Object.keys(data).map((n) => collection(n).countDocuments()),
      );
      expect(counts.reduce((a, b) => a + b, 0)).toBe(808);
      expect(plain(await cypher("MATCH (n) RETURN count(n) AS n"))[0].n).toBe(
        228,
      );
      expect(
        plain(await cypher("MATCH ()-[r]->() RETURN count(r) AS n"))[0].n,
      ).toBe(1260);
    });
    it.each(["A1", "A2", "A3", "A4", "A5", "A6"])(
      "%s matches independent source calculations",
      async (id) => {
        const { rows } = await aggregate(id, userId, new Date(0), now);
        if (id === "A1") {
          const expected = data.songs
            .map((s) => {
              const plays = sessions.filter(
                (p) => p.songId === s.songId && qualified(p),
              );
              return {
                _id: s.songId,
                plays: plays.length,
                listeners: new Set(plays.map((p) => p.userId)).size,
              };
            })
            .filter((r) => r.plays)
            .sort((a, b) => b.plays - a.plays || a._id.localeCompare(b._id))
            .slice(0, 50);
          expect(
            rows.map(({ _id, plays, listeners }) => ({
              _id,
              plays,
              listeners,
            })),
          ).toEqual(expected);
        }
        if (id === "A2") {
          const personal = sessions.filter((s) => s.userId === userId);
          expect(rows[0].playedSeconds).toBeCloseTo(
            sum(personal, "playedSeconds"),
          );
          expect(rows[0].qualifiedPlays).toBe(
            personal.filter(qualified).length,
          );
          expect(rows[0].skips).toBe(
            personal.filter((s) => s.endReason === "skip").length,
          );
          expect(rows[0].completionRatio).toBeCloseTo(
            sum(personal, "completionRatio") / personal.length,
          );
        }
        if (id === "A3") {
          const expected = new Map<string, number>();
          for (const s of sessions) {
            const song = data.songs.find((x) => x.songId === s.songId)!;
            const week = new Date(s.startedAt);
            week.setUTCDate(week.getUTCDate() - week.getUTCDay());
            week.setUTCHours(0, 0, 0, 0);
            for (const genre of song.genreIds) {
              const k = week.toISOString() + genre;
              expected.set(
                k,
                (expected.get(k) || 0) + s.playedSeconds / song.genreIds.length,
              );
            }
          }
          expect(rows.length).toBe(expected.size);
          for (const r of rows)
            expect(r.seconds).toBeCloseTo(
              expected.get(r._id.week.toISOString() + r._id.genreId)!,
            );
        }
        if (id === "A4")
          for (const r of rows) {
            const matching = sessions.filter(
              (s) => s.context.playlistId === r._id,
            );
            expect(r.sessions).toBe(matching.length);
            expect(r.playedSeconds).toBeCloseTo(sum(matching, "playedSeconds"));
          }
        if (id === "A5")
          for (const r of rows) {
            const matching = data.songs.filter((s) =>
              s.artistCredits.some((a: any) => a.artistId === r._id),
            );
            expect(r.creditedSongs).toBe(matching.length);
            expect(r.albums).toBe(new Set(matching.map((s) => s.albumId)).size);
            expect(r.creditBasedDuration).toBe(sum(matching, "durationSec"));
          }
        if (id === "A6")
          for (const r of rows)
            expect(r.listeners).toBe(
              new Set(
                sessions
                  .filter(
                    (s) =>
                      qualified(s) &&
                      s.startedAt.toISOString().slice(0, 7) === r._id,
                  )
                  .map((s) => s.userId),
              ).size,
            );
      },
    );
    it.each(Array.from({ length: 10 }, (_, i) => "C" + (i + 1)))(
      "%s matches its independent graph contract",
      async (id) => {
        const { rows } = await queryGraph(id, params);
        if (id === "C1")
          expect(sorted(rows.map((r: any) => r.songId))).toEqual(
            sorted([
              ...new Set(
                sessions
                  .filter((s) => s.userId === userId)
                  .map((s) => s.songId),
              ),
            ]),
          );
        if (id === "C2")
          for (const r of rows) {
            const songIds = data.songs
              .filter((s) =>
                s.artistCredits.some((a: any) => a.artistId === r.artistId),
              )
              .map((s) => s.songId);
            expect(r.seconds).toBeCloseTo(
              sum(
                sessions.filter(
                  (s) => s.userId === userId && songIds.includes(s.songId),
                ),
                "playedSeconds",
              ),
            );
          }
        if (id === "C3") {
          const follows = data.follows
            .filter((f) => f.userId === userId)
            .map((f) => f.artistId);
          const expected = data.songs
            .filter(
              (s) =>
                !own.has(s.songId) &&
                s.artistCredits.some((a: any) => follows.includes(a.artistId)),
            )
            .map((s) => s.songId)
            .sort()
            .slice(0, 50);
          expect(rows.map((r: any) => r.songId)).toEqual(expected);
        }
        if (id === "C4") expect(rows).toEqual(neighbors);
        if (id === "C5") {
          const scores = new Map<string, number>();
          for (const n of neighbors)
            for (const song of data.songs.filter((s) => !own.has(s.songId))) {
              const listens = sessions.filter(
                (s) =>
                  s.userId === n.userId &&
                  s.songId === song.songId &&
                  qualified(s) &&
                  s.endReason !== "skip",
              );
              const affinity = Math.min(
                1,
                listens.reduce(
                  (a, s) => a + s.playedSeconds / s.durationSecSnapshot / 3,
                  0,
                ),
              );
              if (affinity)
                scores.set(
                  song.songId,
                  (scores.get(song.songId) || 0) + affinity * n.score,
                );
            }
          const expected = [...scores]
            .map(([songId, score]) => ({ songId, score }))
            .sort(
              (a, b) => b.score - a.score || a.songId.localeCompare(b.songId),
            )
            .slice(0, 50);
          expect(rows.map((r: any) => r.songId)).toEqual(
            expected.map((r) => r.songId),
          );
          for (let i = 0; i < rows.length; i++)
            expect(rows[i].score).toBeCloseTo(expected[i].score);
        }
        if (id === "C6" || id === "C10") {
          const gs = new Set(
            id === "C10"
              ? params.genreIds
              : data.songs
                  .filter((s) => positive.has(s.songId))
                  .flatMap((s) => s.genreIds),
          );
          const expected = data.songs
            .map((s) => ({
              songId: s.songId,
              count: s.genreIds.filter((g: string) => gs.has(g)).length,
            }))
            .filter((s) => s.count)
            .sort(
              (a, b) => b.count - a.count || a.songId.localeCompare(b.songId),
            )
            .slice(0, 50);
          expect(
            rows.map((r: any) => ({
              songId: r.songId,
              count: r.sharedGenres ?? r.matchedGenres,
            })),
          ).toEqual(expected);
        }
        if (id === "C7") {
          const tracks = new Set<string>(
            data.playlists[1].tracks.map((t: any) => t.songId),
          );
          const expected = data.playlists
            .filter((p) => p.playlistId !== params.playlistId)
            .map((p) => {
              const ids = new Set<string>(p.tracks.map((t: any) => t.songId));
              const shared = overlap(tracks, ids);
              return {
                playlistId: p.playlistId,
                shared,
                score: shared / (tracks.size + ids.size - shared),
              };
            })
            .filter((r) => r.shared)
            .sort(
              (a, b) =>
                b.score - a.score || a.playlistId.localeCompare(b.playlistId),
            );
          expect(rows).toEqual(expected);
        }
        if (id === "C8") {
          expect(rows.length).toBeGreaterThan(0);
          for (const r of rows) {
            expect(r.path[0]).toBe(params.artistId);
            expect(r.path.at(-1)).toBe(params.otherArtistId);
            expect(r.path.length).toBeLessThanOrEqual(5);
          }
        }
        if (id === "C9") {
          const expected = data.songs
            .filter((s) => sessions.some((p) => p.songId === s.songId))
            .map((s) => ({
              songId: s.songId,
              plays: sessions.filter(
                (p) =>
                  p.songId === s.songId &&
                  qualified(p) &&
                  +p.startedAt >= +now - 7 * 86400000 &&
                  +p.startedAt < +now,
              ).length,
            }))
            .sort(
              (a, b) => b.plays - a.plays || a.songId.localeCompare(b.songId),
            )
            .slice(0, 50);
          expect(rows).toEqual(expected);
        }
      },
    );
    it("GDS degree equals the distinct qualified listener count", async () => {
      await calculateAnalytics();
      const stats = await collection("app_state").findOne({
        _id: "analytics" as any,
      });
      for (const r of stats!.degrees)
        expect(r.distinctOptedInListeners).toBe(
          new Set(
            sessions
              .filter((s) => s.songId === r.songId && qualified(s))
              .map((s) => s.userId),
          ).size,
        );
    });
    it("seven-day query counts 1 recent play instead of 101 lifetime plays", async () => {
      await collection("playback_sessions").deleteMany({});
      const { _id, ...template } = sessions.find((s) => qualified(s))! as any;
      await collection("playback_sessions").insertMany(
        Array.from({ length: 101 }, (_, i) => ({
          ...template,
          sessionId: crypto.randomUUID(),
          startedAt: new Date(i === 100 ? "2026-09-17" : "2020-01-01"),
        })),
      );
      await projectSnapshot(now);
      expect((await queryGraph("C9", params)).rows[0].plays).toBe(1);
      expect(
        plain(
          await cypher(
            "MATCH ()-[r:LISTENED_TO]->() RETURN r.playCount AS count",
          ),
        )[0].count,
      ).toBe(101);
    });
  },
);
