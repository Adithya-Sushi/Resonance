// Opt-in real-provider run. Every selected play runs to YouTube's ENDED event.
// No seeking, accelerated clocks, fabricated telemetry, or database history edits.
import { chromium, expect } from "@playwright/test";
import { mkdir, readFile, writeFile } from "node:fs/promises";

const baseURL = process.env.PLAYBACK_CHECK_URL || "http://127.0.0.1:4000";
const reportPath = "tmp/full-listening-report.json";
const titles = [
  "Severed Rose",
  "Talk",
  "Hold You",
  "Clear My Head",
  "Symphony",
  "Driver Seat",
  "Happier Now",
  "Shake You Off (feat. Shel Bee)",
  "Notice That",
  "Talk",
  "Round n' Round",
  "Severed Rose",
  "Blindfold",
  "Symphony",
  "Moonlight",
  "Hold You",
  "Notice That",
  "Complicated",
  "Driver Seat",
  "Talk",
];
const resume = process.argv.includes("--resume");
let report: Record<string, any>;
if (resume) {
  report = JSON.parse(await readFile(reportPath, "utf8"));
  expect(report.plan).toEqual(titles);
} else {
  const prior = await readFile(reportPath, "utf8").catch(() => null);
  if (prior)
    throw new Error(
      "An earlier report exists. Use --resume, or archive it before a new run.",
    );
  report = {
    startedAt: new Date().toISOString(),
    plan: titles,
    sessions: [],
    favoriteGenres: ["Electronic Rock", "Chill"],
    mode: "real full-length browser playback",
  };
}
await mkdir("tmp", { recursive: true });
const save = () => writeFile(reportPath, JSON.stringify(report, null, 2));
const browser = await chromium.launch({ channel: "chrome", headless: false });
try {
  const page = await browser.newPage({
    viewport: { width: 1440, height: 950 },
  });
  await page.goto(baseURL);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await page
    .getByLabel("Email", { exact: true })
    .fill(process.env.PLAYBACK_CHECK_EMAIL || "listener@resonance.local");
  await page
    .getByLabel("Password", { exact: true })
    .fill(process.env.SEED_PASSWORD || "ResonanceDemo!2026");
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Sign in", exact: true })
    .click();
  await expect(page.getByRole("button", { name: "Sign out" })).toBeVisible();
  const get = async (path: string) => {
    const response = await page.request.get(baseURL + "/api/v1" + path);
    expect(response.ok()).toBe(true);
    return response.json();
  };
  const catalog: any[] = [];
  for (let n = 1; ; n++) {
    const result = await get(`/songs?limit=50&page=${n}`);
    catalog.push(...result.items);
    if (catalog.length >= result.total || result.items.length === 0) break;
  }
  const songs = titles.map((title) => {
    const song = catalog.find((s) => s.title === title);
    if (!song) throw new Error("Missing catalog track: " + title);
    return song;
  });
  report.expectedSeconds = songs.reduce((n, s) => n + s.durationSec, 0);
  report.catalogCount = catalog.length;
  report.before ??= await get("/recommendations");
  report.status = "playing";
  delete report.error;
  await save();
  console.log(
    `Plan: ${songs.length} full plays, ${new Set(titles).size} distinct tracks, ${(report.expectedSeconds / 60).toFixed(1)} minutes of music`,
  );
  await page.getByRole("link", { name: "Explore", exact: true }).click();
  const bar = page.locator(".player-bar");
  for (const [index, song] of songs.entries()) {
    if (report.sessions.some((s: any) => s.index === index && s.verified))
      continue;
    await page.getByLabel("Search catalog").fill(song.title);
    const started = page.waitForResponse(
      (r) =>
        r.url().endsWith("/api/v1/playback") &&
        r.request().method() === "POST" &&
        r.request().postDataJSON().songId === song.songId,
      { timeout: 45000 },
    );
    started.catch(() => {});
    await page
      .getByRole("button", { name: "Play " + song.title, exact: true })
      .click();
    const start = await started;
    expect(start.ok()).toBe(true);
    const session = await start.json();
    const result: Record<string, any> = {
      index,
      title: song.title,
      songId: song.songId,
      genres: song.genres.map((g: any) => g.name),
      sessionId: session.sessionId,
      startedAt: session.startedAt,
      durationSec: session.durationSecSnapshot,
    };
    report.sessions.push(result);
    report.current = { index, title: song.title };
    await save();
    console.log(
      `START ${index + 1}/${songs.length}: ${song.title} (${song.durationSec}s)`,
    );
    const progress = setInterval(
      () =>
        console.log(
          `PLAYING ${index + 1}/${songs.length}: ${song.title}; ${report.sessions.filter((s: any) => s.verified).length} completed`,
        ),
      45000,
    );
    try {
      const ended = await page.waitForResponse(
        (r) =>
          r.url().endsWith("/playback/" + session.sessionId) &&
          r.request().method() === "PUT" &&
          r.request().postDataJSON().endReason === "ended",
        { timeout: (song.durationSec + 150) * 1000 },
      );
      expect(ended.ok()).toBe(true);
      const saved = await ended.json();
      expect(saved.status).toBe("finalized");
      expect(saved.endReason).toBe("ended");
      expect(saved.completionRatio).toBeGreaterThanOrEqual(0.98);
      expect(saved.playedSeconds).toBeGreaterThanOrEqual(
        song.durationSec * 0.98,
      );
      expect(saved.synthetic).not.toBe(true);
      result.persisted = {
        status: saved.status,
        endReason: saved.endReason,
        playedSeconds: saved.playedSeconds,
        completionRatio: saved.completionRatio,
        coverageRanges: saved.coverageRanges,
        seq: saved.seq,
        endedAt: saved.endedAt,
        synthetic: saved.synthetic === true,
      };
      result.verified = true;
      await expect(bar.getByRole("alert")).toHaveCount(0);
      report.progress = {
        completed: report.sessions.filter((s: any) => s.verified).length,
        seconds: report.sessions
          .filter((s: any) => s.verified)
          .reduce((n: number, s: any) => n + s.persisted.playedSeconds, 0),
      };
      await save();
      console.log(
        `COMPLETE ${index + 1}/${songs.length}: ${song.title}, ${saved.playedSeconds.toFixed(2)}s, ${(saved.completionRatio * 100).toFixed(2)}% coverage`,
      );
    } finally {
      clearInterval(progress);
    }
  }
  const verified = report.sessions.filter((s: any) => s.verified);
  expect(verified).toHaveLength(titles.length);
  const history = await get("/history");
  for (const s of verified) {
    const persisted = history.items.find(
      (h: any) => h.sessionId === s.sessionId,
    );
    expect(persisted?.endReason).toBe("ended");
    expect(persisted?.completionRatio).toBeGreaterThanOrEqual(0.98);
  }
  await expect
    .poll(
      async () => {
        report.after = await get("/recommendations");
        return report.after.source;
      },
      { timeout: 30000 },
    )
    .toBe("graph");
  report.topFive = report.after.items
    .slice(0, 5)
    .map((s: any) => ({
      title: s.title,
      genres: s.genres.map((g: any) => g.name),
      reason: s.reason,
    }));
  expect(report.topFive).toHaveLength(5);
  expect(
    report.topFive.every((s: any) =>
      s.genres.some((g: string) => report.favoriteGenres.includes(g)),
    ),
  ).toBe(true);
  const heard = new Set(verified.map((s: any) => s.songId));
  expect(report.after.items.some((s: any) => heard.has(s.songId))).toBe(false);
  await page.getByRole("link", { name: "For you", exact: true }).click();
  await expect(
    page
      .getByRole("button", {
        name: "Play " + report.topFive[0].title,
        exact: true,
      })
      .first(),
  ).toBeVisible();
  await page.screenshot({
    path: "tmp/full-listening-recommendations.png",
    fullPage: true,
  });
  report.status = "complete";
  report.finishedAt = new Date().toISOString();
  console.log(
    JSON.stringify({
      status: report.status,
      progress: report.progress,
      topFive: report.topFive,
    }),
  );
} catch (error) {
  report.status = "needs-retry";
  report.error = String(error);
  throw error;
} finally {
  await save();
  await browser.close();
}
