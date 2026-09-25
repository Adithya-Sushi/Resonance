// Opt-in real-provider check. Requires the seeded app and Chrome; creates short
// listening sessions in the selected demo account. Never mocks or downloads media.
import { chromium, expect } from "@playwright/test";
import { mkdir, writeFile } from "node:fs/promises";
import { demoCatalog } from "../apps/api/src/demo-catalog.js";
import { demoSongId } from "../apps/api/src/seed-data.js";

const browser = await chromium.launch({ channel: "chrome", headless: false });
const results: Record<string, unknown>[] = [];
const url = process.env.PLAYBACK_CHECK_URL || "http://127.0.0.1:4000";
const selectedIds = process.env.PLAYBACK_CHECK_VIDEO_IDS?.split(",");
try {
  const page = await browser.newPage({
    viewport: { width: 1440, height: 950 },
  });
  await page.goto(url);
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
  await page.getByRole("link", { name: "Explore", exact: true }).click();
  const bar = page.locator(".player-bar");
  for (const [i, song] of demoCatalog.entries()) {
    if (selectedIds && !selectedIds.includes(song.videoId)) continue;
    if (process.argv.includes("--additions") && i < 15) continue;
    if (process.argv.includes("--latest-20") && i < 50) continue;
    try {
      await page.getByLabel("Search catalog").fill(song.title);
      const started = page.waitForResponse(
        (r) =>
          r.url().endsWith("/api/v1/playback") &&
          r.request().method() === "POST" &&
          r.request().postDataJSON().songId === demoSongId(i),
        { timeout: 60000 },
      );
      // Attach rejection immediately while the click/waits are pending.
      started.catch(() => {});
      await page
        .getByRole("button", { name: "Play " + song.title, exact: true })
        .first()
        .click();
      const response = await started;
      expect(response.ok()).toBe(true);
      const session = await response.json();
      await expect(
        bar.getByRole("button", { name: "Pause", exact: true }),
      ).toBeEnabled();
      await expect
        .poll(
          async () =>
            Number(await bar.locator("progress").getAttribute("value")),
          { timeout: 15000 },
        )
        .toBeGreaterThanOrEqual(3);
      await expect(bar.getByRole("alert")).toHaveCount(0);
      const checkpoint = page.waitForResponse(
        (r) =>
          r.url().endsWith("/playback/" + session.sessionId) &&
          r.request().method() === "PUT",
      );
      await bar.getByRole("button", { name: "Pause", exact: true }).click();
      const saved = await checkpoint;
      expect(saved.ok()).toBe(true);
      const playedSeconds = saved.request().postDataJSON().playedSeconds;
      expect(playedSeconds).toBeGreaterThan(0);
      results.push({
        title: song.title,
        videoId: song.videoId,
        passed: true,
        playedSeconds,
      });
    } catch (error) {
      results.push({
        title: song.title,
        videoId: song.videoId,
        passed: false,
        error: String(error),
        playerMessage: await bar.getByRole("alert").allTextContents(),
      });
    }
    console.log(JSON.stringify(results.at(-1)));
  }
  await mkdir("tmp", { recursive: true });
  await writeFile(
    process.env.PLAYBACK_CHECK_REPORT || "tmp/demo-playback-check.json",
    JSON.stringify(
      {
        checkedAt: new Date().toISOString(),
        url,
        browser: await browser.version(),
        results,
      },
      null,
      2,
    ),
  );
  if (results.some((r) => !r.passed)) process.exitCode = 1;
} finally {
  await browser.close();
}
