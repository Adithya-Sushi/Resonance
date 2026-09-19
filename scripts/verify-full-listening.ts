// Read-only verification of the real browser run and its MongoDB/Neo4j projection.
import { readFile, writeFile } from "node:fs/promises";
import assert from "node:assert/strict";
import { collection, closeDb, cypher } from "../apps/api/src/db.js";
import { plain } from "../apps/api/src/analytics.js";
import { recommendations } from "../apps/api/src/app.js";
import { qualified } from "@resonance/shared";

const report = JSON.parse(
  await readFile("tmp/full-listening-report.json", "utf8"),
);
try {
  assert.equal(report.status, "complete", "Finish the browser run first");
  const verified = report.sessions.filter((s: any) => s.verified);
  assert.equal(verified.length, report.plan.length);
  const ids = verified.map((s: any) => s.sessionId);
  assert.equal(new Set(ids).size, ids.length);
  const sessions = await collection("playback_sessions")
    .find({ sessionId: { $in: ids } })
    .sort({ startedAt: 1 })
    .toArray();
  assert.equal(sessions.length, ids.length);
  const user = await collection("users").findOne({
    userId: sessions[0].userId,
  });
  assert.equal(
    user?.emailNormalized,
    process.env.PLAYBACK_CHECK_EMAIL || "listener@resonance.local",
  );
  assert(user);
  const songIds = [...new Set(sessions.map((s) => s.songId))];
  const songs = await collection("songs")
    .find({ songId: { $in: songIds } })
    .toArray();
  const rows = sessions.map((s, index) => {
    const song = songs.find((song) => song.songId === s.songId)!;
    assert.equal(s.userId, user.userId);
    assert.equal(s.status, "finalized");
    assert.equal(s.endReason, "ended");
    assert.notEqual(s.synthetic, true);
    assert(s.completionRatio >= 0.98);
    assert(s.playedSeconds >= s.durationSecSnapshot * 0.98);
    assert.equal(s.videoIdSnapshot, song.media.videoId);
    assert.equal(s.durationSecSnapshot, song.durationSec);
    assert(+s.endedAt <= Date.now());
    assert(+s.startedAt >= +new Date(report.startedAt));
    if (index) assert(+s.startedAt >= +sessions[index - 1].endedAt);
    return {
      title: song.title,
      sessionId: s.sessionId,
      playedSeconds: s.playedSeconds,
      completionRatio: s.completionRatio,
      endReason: s.endReason,
      checkpoints: s.seq,
    };
  });
  const all = await collection("playback_sessions")
    .find({
      userId: user.userId,
      songId: { $in: songIds },
      status: "finalized",
    })
    .toArray();
  const expected = songIds.map((songId) => {
    const history = all.filter((s) => s.songId === songId);
    const totals = (rows: typeof history) => ({
      totalSeconds: rows.reduce((n, s) => n + s.playedSeconds, 0),
      playCount: rows.filter((s) =>
        qualified(s.playedSeconds, s.durationSecSnapshot),
      ).length,
      skipCount: rows.filter((s) => s.endReason === "skip").length,
      affinity: Math.min(
        1,
        rows
          .filter(
            (s) =>
              s.endReason !== "skip" &&
              qualified(s.playedSeconds, s.durationSecSnapshot),
          )
          .reduce((n, s) => n + s.playedSeconds / s.durationSecSnapshot / 3, 0),
      ),
    });
    return {
      songId,
      title: songs.find((s) => s.songId === songId)!.title,
      before: totals(history.filter((s) => !ids.includes(s.sessionId))),
      after: totals(history),
    };
  });
  let graph: any[] = [];
  for (let attempt = 0; attempt < 12; attempt++) {
    graph = plain(
      await cypher(
        "MATCH (:User {userId:$userId})-[r:LISTENED_TO]->(s:Song) WHERE s.songId IN $ids RETURN s.songId AS songId,r.totalSeconds AS totalSeconds,r.playCount AS playCount,r.skipCount AS skipCount,r.affinity AS affinity",
        { userId: user.userId, ids: songIds },
      ),
    );
    if (
      expected.every((e) => {
        const g = graph.find((g) => g.songId === e.songId);
        return (
          g &&
          Math.abs(g.totalSeconds - e.after.totalSeconds) < 0.01 &&
          g.playCount === e.after.playCount &&
          g.skipCount === e.after.skipCount &&
          Math.abs(g.affinity - e.after.affinity) < 0.00001
        );
      })
    )
      break;
    if (attempt === 11)
      throw new Error(
        "Graph did not converge to the recorded listening totals",
      );
    await new Promise((r) => setTimeout(r, 2000));
  }
  const rec = await recommendations(user);
  assert.equal(rec.source, "graph");
  const topFive = rec.items
    .slice(0, 5)
    .map((s: any) => ({
      title: s.title,
      genres: s.genres.map((g: any) => g.name),
      reason: s.reason,
    }));
  assert.equal(topFive.length, 5);
  assert(
    topFive.every((s) =>
      s.genres.some((g: string) => report.favoriteGenres.includes(g)),
    ),
  );
  assert(!rec.items.some((s: any) => songIds.includes(s.songId)));
  const result = {
    verifiedAt: new Date().toISOString(),
    activeSongs: await collection("songs").countDocuments({ status: "active" }),
    completed: rows.length,
    distinctSongs: songIds.length,
    listenedSeconds: rows.reduce((n, s) => n + s.playedSeconds, 0),
    minimumCoverage: Math.min(...rows.map((s) => s.completionRatio)),
    sessions: rows,
    affinityChanges: expected,
    topFive,
    outbox: await collection("sync_outbox")
      .aggregate([{ $group: { _id: "$status", count: { $sum: 1 } } }])
      .toArray(),
  };
  assert.equal(result.activeSongs, 70);
  await writeFile(
    "tmp/full-listening-verification.json",
    JSON.stringify(result, null, 2),
  );
  console.log(JSON.stringify(result, null, 2));
} finally {
  await closeDb();
}
