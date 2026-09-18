import assert from "node:assert/strict";
import { writeFile } from "node:fs/promises";
import { collection, closeDb } from "../apps/api/src/db.js";
const origin = process.env.TEST_ORIGIN || "http://127.0.0.1:4000";
let cookie = "",
  csrf = "";
async function api(path: string, method = "GET", body?: unknown) {
  const res = await fetch(origin + "/api/v1" + path, {
    method,
    headers: {
      "Content-Type": "application/json",
      Cookie: cookie,
      "X-CSRF-Token": csrf,
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const cookies = res.headers.getSetCookie();
  if (cookies.length) cookie = cookies.map((c) => c.split(";")[0]).join("; ");
  const data = await res.json();
  assert(res.ok, JSON.stringify(data));
  if (data.csrfToken) csrf = data.csrfToken;
  return data;
}
async function measure(path: string) {
  for (let i = 0; i < 5; i++) await api(path);
  const values = [];
  for (let i = 0; i < 100; i++) {
    const start = performance.now();
    await api(path);
    values.push(performance.now() - start);
  }
  values.sort((a, b) => a - b);
  return {
    samples: 100,
    p50Ms: +values[50].toFixed(2),
    p95Ms: +values[94].toFixed(2),
    maxMs: +values[99].toFixed(2),
  };
}
let playlist: any;
try {
  await api("/auth/me");
  await api("/auth/login", "POST", {
    email: "admin@resonance.local",
    password: process.env.SEED_PASSWORD || "ResonanceDemo!2026",
  });
  const catalog = await measure("/songs?limit=24"),
    recommendations = await measure("/recommendations");
  const started = performance.now();
  playlist = await api("/playlists", "POST", {
    name: "Temporary synchronization verification",
    visibility: "public",
  });
  let processed = false;
  while (performance.now() - started < 15000) {
    const task = await collection("sync_outbox").findOne({
      aggregateId: playlist.playlistId,
      status: "processed",
    });
    if (task) {
      processed = true;
      break;
    }
    await new Promise((r) => setTimeout(r, 200));
  }
  assert(processed, "Synchronization did not finish within 15 seconds");
  const synchronizationMs = Math.round(performance.now() - started);
  const explain = await collection("songs")
    .find({ status: "active", searchTitle: /^fa/ })
    .explain("executionStats");
  const evidence = {
    measuredAt: new Date().toISOString(),
    method:
      "100 sequential warm authenticated HTTP requests to the Node 24 Docker API over loopback; no YouTube transfer time",
    origin,
    catalog,
    recommendations,
    synchronizationMs,
    targets: {
      catalogP95Ms: 500,
      recommendationsP95Ms: 2000,
      synchronizationMs: 10000,
    },
    prefixSearchPlan: {
      winningPlan: explain.queryPlanner.winningPlan,
      returned: explain.executionStats.nReturned,
      documentsExamined: explain.executionStats.totalDocsExamined,
      keysExamined: explain.executionStats.totalKeysExamined,
    },
  };
  assert(catalog.p95Ms < 500);
  assert(recommendations.p95Ms < 2000);
  assert(synchronizationMs < 10000);
  await writeFile(
    "docs/http-benchmark.json",
    JSON.stringify(evidence, null, 2) + "\n",
  );
  console.log(JSON.stringify(evidence, null, 2));
} finally {
  if (playlist)
    await api("/playlists/" + playlist.playlistId, "DELETE", {
      version: playlist.version,
    });
  if (cookie) await api("/auth/logout", "POST").catch(() => {});
  await closeDb();
}
