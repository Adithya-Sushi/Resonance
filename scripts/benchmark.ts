import { performance } from "node:perf_hooks";
import os from "node:os";
import { writeFile } from "node:fs/promises";
import { collection, closeDb } from "../apps/api/src/db.js";
import { listSongs } from "../apps/api/src/catalog.js";
import { recommendations } from "../apps/api/src/app.js";
const measure = async (fn: () => Promise<unknown>, n = 100) => {
  for (let i = 0; i < 5; i++) await fn();
  const timings = [];
  for (let i = 0; i < n; i++) {
    const start = performance.now();
    await fn();
    timings.push(performance.now() - start);
  }
  timings.sort((a, b) => a - b);
  return {
    samples: n,
    p50Ms: +timings[Math.floor(n * 0.5)].toFixed(2),
    p95Ms: +timings[Math.ceil(n * 0.95) - 1].toFixed(2),
    maxMs: +timings.at(-1)!.toFixed(2),
  };
};
try {
  const user = await collection("users").findOne({
    emailNormalized: "admin@resonance.local",
  });
  if (!user) throw new Error("Seed the demo first");
  const result = {
    measuredAt: new Date().toISOString(),
    hardware: {
      platform: os.platform(),
      arch: os.arch(),
      cpu: os.cpus()[0].model,
      logicalCpus: os.cpus().length,
      memoryGB: Math.round(os.totalmem() / 1024 ** 3),
      node: process.version,
    },
    dataset: {
      songs: await collection("songs").countDocuments(),
      sessions: await collection("playback_sessions").countDocuments(),
    },
    method:
      "Sequential warm service calls on local databases; excludes HTTP/browser/YouTube network time",
    catalog: await measure(() => listSongs({ limit: 24 })),
    recommendations: await measure(() => recommendations(user)),
    targets: { catalogP95Ms: 500, recommendationsP95Ms: 2000 },
  };
  await writeFile(
    "docs/benchmark.json",
    JSON.stringify(result, null, 2) + "\n",
  );
  console.log(JSON.stringify(result, null, 2));
} finally {
  await closeDb();
}
