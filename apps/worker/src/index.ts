import { randomUUID } from "node:crypto";
import {
  collection,
  mongo,
  closeDb,
  transaction,
  outbox,
} from "../../api/src/db.js";
import {
  processImport,
  refreshYoutubeMetadata,
} from "../../api/src/imports.js";
import { projectSnapshot, calculateAnalytics } from "./projection.js";
let importInFlight: Promise<unknown> | null = null;
const owner = randomUUID();
let stopped = false,
  lastAnalytics = 0,
  lastMetadata = 0,
  lastReconcile = 0;
async function acquire() {
  try {
    return await collection("worker_lock").findOneAndUpdate(
      {
        _id: "projection" as any,
        $or: [{ expiresAt: { $lt: new Date() } }, { owner }],
      },
      { $set: { owner, expiresAt: new Date(Date.now() + 120000) } },
      { upsert: true, returnDocument: "after" },
    );
  } catch {
    return null;
  }
}
export async function cleanSessions() {
  const stale = await collection("playback_sessions")
    .find({
      status: "in_progress",
      lastCheckpointAt: { $lt: new Date(Date.now() - 120000) },
    })
    .limit(100)
    .toArray();
  for (const p of stale)
    await transaction(async (s) => {
      const r = await collection("playback_sessions").updateOne(
        { sessionId: p.sessionId, status: "in_progress", seq: p.seq },
        {
          $set: {
            status: "finalized",
            endReason: "interrupted",
            endedAt: p.lastCheckpointAt,
          },
          $inc: { version: 1 },
        },
        { session: s },
      );
      if (r.modifiedCount)
        await outbox(s, "users", p.userId, p.version + 1, p.userId);
    });
}
export async function cleanAccounts() {
  for (const u of await collection("users")
    .find({ status: "deleting", cleanupReady: { $ne: true } })
    .toArray()) {
    for (const [name, key] of [
      ["playlists", "ownerUserId"],
      ["follows", "userId"],
      ["playback_sessions", "userId"],
    ]) {
      const ids = await collection(name)
        .find({ [key]: u.userId }, { projection: { _id: 1 } })
        .limit(100)
        .toArray();
      if (ids.length)
        await collection(name).deleteMany({
          _id: { $in: ids.map((x) => x._id) },
        });
    }
    const remaining = await Promise.all([
      collection("playlists").countDocuments({ ownerUserId: u.userId }),
      collection("follows").countDocuments({ userId: u.userId }),
      collection("playback_sessions").countDocuments({ userId: u.userId }),
    ]);
    if (remaining.every((x) => x === 0))
      await transaction(async (s) => {
        await collection("users").replaceOne(
          { userId: u.userId },
          {
            userId: u.userId,
            status: "deleting",
            cleanupReady: true,
            version: u.version + 1,
          },
          { session: s },
        );
        await outbox(s, "users", u.userId, u.version + 1, u.userId);
      });
  }
}
export async function tick() {
  await cleanSessions();
  await cleanAccounts();
  const commands = await collection("app_state").findOneAndUpdate(
    { _id: "commands" as any },
    { $set: { rebuild: false, analytics: false } },
    { returnDocument: "before" },
  );
  const tasks = await collection("sync_outbox")
    .find({ status: "pending", nextAttemptAt: { $lte: new Date() } })
    .sort({ createdAt: 1 })
    .limit(200)
    .toArray();
  const hourly =
    Date.now() - lastAnalytics > 3600000 ||
    !(await collection("app_state").findOne({ _id: "analytics" as any }));
  if (
    tasks.length ||
    commands?.rebuild ||
    hourly ||
    Date.now() - lastReconcile > 300000
  ) {
    try {
      const prior = await collection("app_state").findOne({
        _id: "projection" as any,
      });
      await projectSnapshot(
        hourly ? new Date() : prior?.windowEnd || new Date(),
      );
      await collection("sync_outbox").updateMany(
        { taskId: { $in: tasks.map((x) => x.taskId) } },
        {
          $set: {
            status: "processed",
            processedAt: new Date(),
            lastError: null,
          },
        },
      );
      await collection("users").updateMany(
        { status: "deleting", cleanupReady: true },
        { $set: { status: "deleted", deletedAt: new Date() } },
      );
      lastReconcile = Date.now();
      if (hourly || commands?.analytics || commands?.rebuild) {
        await calculateAnalytics();
        lastAnalytics = Date.now();
      }
      await collection("app_state").updateOne(
        { _id: "worker" as any },
        { $set: { healthy: true, lastSyncAt: new Date(), error: null } },
        { upsert: true },
      );
    } catch (e) {
      for (const task of tasks) {
        const attempts = task.attempts + 1;
        await collection("sync_outbox").updateOne(
          { taskId: task.taskId },
          {
            $set: {
              attempts,
              status: attempts >= 10 ? "failed" : "pending",
              nextAttemptAt: new Date(
                Date.now() + Math.min(300000, 1000 * 2 ** attempts),
              ),
              lastError:
                "Graph synchronization failed; check Neo4j availability and worker logs",
            },
          },
        );
      }
      await collection("app_state").updateOne(
        { _id: "worker" as any },
        {
          $set: {
            healthy: false,
            checkedAt: new Date(),
            error: (e as Error).message.slice(0, 300),
          },
        },
        { upsert: true },
      );
      console.error("Graph synchronization:", (e as Error).message);
    }
  } else if (commands?.analytics) {
    try {
      await calculateAnalytics();
      lastAnalytics = Date.now();
    } catch (e) {
      console.error("Analytics:", (e as Error).message);
    }
  }
  if (!importInFlight)
    importInFlight = processImport()
      .catch((e) => console.error("Import:", e.message))
      .finally(() => {
        importInFlight = null;
      });
  if (Date.now() - lastMetadata > 3600000) {
    await refreshYoutubeMetadata();
    lastMetadata = Date.now();
  }
}
async function main() {
  await mongo.connect();
  if (process.argv.includes("--rebuild")) {
    await collection("app_state").updateOne(
      { _id: "commands" as any },
      { $set: { rebuild: true } },
      { upsert: true },
    );
    console.log("Rebuild queued for the single worker.");
    await closeDb();
    return;
  }
  if (!(await acquire())) {
    console.error("A synchronization worker already owns the lease.");
    await closeDb();
    process.exitCode = 1;
    return;
  }
  const renew = setInterval(async () => {
    const r = await collection("worker_lock")
      .updateOne(
        { _id: "projection" as any, owner },
        { $set: { expiresAt: new Date(Date.now() + 120000) } },
      )
      .catch(() => null);
    if (!r?.matchedCount) {
      stopped = true;
      console.error("Worker lease lost; stopping");
    }
  }, 15000);
  for (const signal of ["SIGINT", "SIGTERM"])
    process.on(signal, () => {
      stopped = true;
    });
  console.log("Resonance synchronization and import worker started");
  try {
    while (!stopped) {
      try {
        await tick();
      } catch (e) {
        console.error("Worker:", (e as Error).message);
      }
      if (!stopped) await new Promise((r) => setTimeout(r, 2000));
    }
  } finally {
    clearInterval(renew);
    await importInFlight;
    await collection("worker_lock").deleteOne({
      _id: "projection" as any,
      owner,
    });
    await closeDb();
  }
}
if (!process.env.VITEST)
  main().catch((e) => {
    console.error(e);
    process.exitCode = 1;
  });
