import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { writeFile } from "node:fs/promises";
process.env.VITEST = "recovery-check"; // Import worker functions without starting a second worker.
process.env.MONGO_DB = "resonance_recovery_" + Date.now();
process.env.NEO4J_URI = "bolt://127.0.0.1:7688";
process.env.YOUTUBE_API_KEY = "";
const { collection, initDb, closeDb, transaction, outbox, cypher } =
  await import("../apps/api/src/db.js");
const { seedData } = await import("../apps/api/src/seed-data.js");
const { projectSnapshot } = await import("../apps/worker/src/projection.js");
const { recommendations } = await import("../apps/api/src/app.js");
const { tick } = await import("../apps/worker/src/index.js");
const run = promisify(execFile);
const compose = (action: "stop" | "start") =>
  run(
    "docker",
    [
      "compose",
      "-f",
      "compose.test.yaml",
      "-p",
      "resonance-test",
      action,
      "neo4j-test",
    ],
    { timeout: 45000 },
  );
const evidence: Record<string, unknown> = {
  measuredAt: new Date().toISOString(),
  database: process.env.MONGO_DB,
  graph: "isolated test service at port 7688",
};
let stopped = false;
try {
  await initDb();
  const data = seedData(false, "not-a-login-password");
  for (const [name, rows] of Object.entries(data))
    await collection(name).insertMany(rows);
  await projectSnapshot();
  await compose("stop");
  stopped = true;
  await transaction(async (session) => {
    await collection("songs").updateOne(
      { songId: data.songs[0].songId },
      {
        $set: { title: "Committed during graph outage" },
        $inc: { version: 1 },
      },
      { session },
    );
    await outbox(session, "songs", data.songs[0].songId, 2);
  });
  const started = performance.now();
  const fallback = await recommendations(data.users[19]);
  assert.equal(fallback.source, "popularity-fallback");
  assert(fallback.items.length > 0);
  evidence.fallbackMilliseconds = Math.round(performance.now() - started);
  evidence.authoritativeWriteWhileGraphOffline = "passed";
  await tick();
  const task = await collection("sync_outbox").findOne({
    aggregateId: data.songs[0].songId,
  });
  assert.equal(task!.status, "pending");
  assert.equal(task!.attempts, 1);
  await collection("sync_outbox").updateOne(
    { taskId: task!.taskId },
    { $set: { attempts: 9, nextAttemptAt: new Date(0) } },
  );
  await tick();
  assert.equal(
    (await collection("sync_outbox").findOne({ taskId: task!.taskId }))!.status,
    "failed",
  );
  evidence.tenthAttemptSurfacedAsFailed =
    "passed (prior attempt counter set to nine)";
  await compose("start");
  stopped = false;
  let available = false;
  for (let i = 0; i < 30; i++) {
    try {
      await cypher("RETURN 1 AS ok");
      available = true;
      break;
    } catch {
      await new Promise((r) => setTimeout(r, 1000));
    }
  }
  assert(available, "Test graph did not restart");
  await collection("sync_outbox").updateOne(
    { taskId: task!.taskId },
    { $set: { status: "pending", attempts: 0, nextAttemptAt: new Date() } },
  );
  await tick();
  assert.equal(
    (await collection("sync_outbox").findOne({ taskId: task!.taskId }))!.status,
    "processed",
  );
  assert.equal(
    (
      await cypher("MATCH (s:Song {songId:$id}) RETURN s.title AS title", {
        id: data.songs[0].songId,
      })
    )[0].title,
    "Committed during graph outage",
  );
  evidence.recoveryAndAcknowledgment = "passed";
  const before = JSON.stringify(
    await cypher(
      "MATCH ()-[r:LISTENED_TO]->() RETURN sum(r.playCount) AS plays,sum(r.totalSeconds) AS seconds",
    ),
  );
  await collection("sync_outbox").updateOne(
    { taskId: task!.taskId },
    { $set: { status: "pending", nextAttemptAt: new Date() } },
  );
  await tick();
  assert.equal(
    JSON.stringify(
      await cypher(
        "MATCH ()-[r:LISTENED_TO]->() RETURN sum(r.playCount) AS plays,sum(r.totalSeconds) AS seconds",
      ),
    ),
    before,
  );
  evidence.replayAfterGraphCommit = "passed; absolute totals unchanged";
  await writeFile(
    new URL("../docs/recovery.json", import.meta.url),
    JSON.stringify(evidence, null, 2) + "\n",
  );
  console.log(JSON.stringify(evidence, null, 2));
} finally {
  if (stopped) await compose("start");
  await closeDb();
}
