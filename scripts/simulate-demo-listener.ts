// Opt-in demonstration using real, visible YouTube playback and ordinary UI actions.
// Takes about ten minutes. It updates only the selected demo user's preferences,
// follows, playlist and real playback sessions; it never fabricates checkpoints.
import { chromium, expect } from "@playwright/test";
import { mkdir, writeFile } from "node:fs/promises";

const baseURL = process.env.PLAYBACK_CHECK_URL || "http://127.0.0.1:4000";
const browser = await chromium.launch({ channel: "chrome", headless: false });
const report: Record<string, any> = {
  startedAt: new Date().toISOString(),
  favoriteGenres: ["Electronic Rock", "Chill"],
  sessions: [],
};
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
  report.before = await (
    await page.request.get(baseURL + "/api/v1/recommendations")
  ).json();
  const catalog: { items: any[] } = { items: [] };
  for (let n = 1; ; n++) {
    const response = await page.request.get(
      baseURL + `/api/v1/songs?limit=50&page=${n}`,
    );
    expect(response.ok()).toBe(true);
    const batch = await response.json();
    catalog.items.push(...batch.items);
    if (catalog.items.length >= batch.total || batch.items.length === 0) break;
  }
  const allGenres = await (
    await page.request.get(baseURL + "/api/v1/genres")
  ).json();
  const songs = new Map<string, any>(
    catalog.items.map((s: any) => [s.title, s]),
  );
  await page.getByRole("link", { name: "Preferences", exact: true }).click();
  for (const genre of allGenres)
    await page
      .getByLabel(genre.name, { exact: true })
      .setChecked(report.favoriteGenres.includes(genre.name));
  await page.getByLabel("Participate in personalized recommendations").check();
  await page
    .getByRole("button", { name: "Save preferences", exact: true })
    .click();
  await expect(page.getByText("Profile saved", { exact: true })).toBeVisible();
  const artists = await (
    await page.request.get(baseURL + "/api/v1/artists")
  ).json();
  // Explicit follows complement the favorite-genre settings; old follows are retained.
  for (const name of ["Clarx", "Beave"]) {
    const artist = artists.find((a: any) => a.name === name);
    if (!artist) throw new Error("Missing artist " + name);
    await page.goto(baseURL + "/artists/" + artist.artistId);
    const follow = page.getByRole("button", {
      name: "Follow artist",
      exact: true,
    });
    await expect(
      page.getByRole("heading", { name, exact: true }),
    ).toBeVisible();
    if (await follow.count()) await follow.click();
    await expect(
      page.getByRole("button", { name: "Following", exact: true }),
    ).toBeVisible();
  }
  const playlistName =
    "Rock & unwind — demo " + new Date().toISOString().slice(0, 10);
  await page.getByRole("link", { name: "Your library", exact: true }).click();
  const existingPlaylist = page.getByRole("heading", {
    name: playlistName,
    exact: true,
  });
  const newPlaylist = !(await existingPlaylist.count());
  if (newPlaylist) {
    await page.getByLabel("New playlist name").fill(playlistName);
    await page
      .getByRole("button", { name: "Create playlist", exact: true })
      .click();
    await expect(
      page.getByRole("heading", { name: playlistName, exact: true }),
    ).toBeVisible();
  }
  await page.getByRole("link", { name: "Explore", exact: true }).click();
  if (newPlaylist)
    for (const title of [
      "Severed Rose",
      "Talk",
      "Notice That",
      "Symphony",
      "Happier Now",
    ]) {
      await page.getByLabel("Search catalog").fill(title);
      await page
        .getByRole("button", {
          name: "Add " + title + " to playlist",
          exact: true,
        })
        .click();
      await page
        .getByRole("button", { name: playlistName, exact: true })
        .click();
      await expect(page.getByRole("dialog")).toHaveCount(0);
    }
  report.playlist = playlistName;
  const bar = page.locator(".player-bar");
  const plan = [
    { title: "Severed Rose", mode: "complete", seconds: 0 },
    { title: "Talk", mode: "complete", seconds: 0 },
    { title: "Clear My Head", mode: "sample", seconds: 45 },
    { title: "Avatar", mode: "skip", seconds: 9 },
    { title: "Only Human", mode: "skip", seconds: 12 },
    { title: "Symphony", mode: "sample", seconds: 75 },
    { title: "Notice That", mode: "complete", seconds: 0 },
  ];
  for (const step of plan) {
    const song = songs.get(step.title);
    if (!song) throw new Error("Missing song " + step.title);
    await page.getByLabel("Search catalog").fill(step.title);
    const start = page.waitForResponse(
      (r) =>
        r.url().endsWith("/api/v1/playback") &&
        r.request().method() === "POST" &&
        r.request().postDataJSON().songId === song.songId,
      { timeout: 30000 },
    );
    start.catch(() => {});
    await page
      .getByRole("button", { name: "Play " + step.title, exact: true })
      .click();
    const response = await start;
    expect(response.ok()).toBe(true);
    const session = await response.json();
    const result: Record<string, any> = {
      ...step,
      songId: song.songId,
      sessionId: session.sessionId,
    };
    report.sessions.push(result);
    console.log(
      "Listening:",
      step.title,
      step.mode,
      step.seconds || song.durationSec,
      "seconds",
    );
    const progress = setInterval(
      () => console.log("Still playing:", step.title),
      45000,
    );
    try {
      if (step.mode === "complete") {
        const ended = await page.waitForResponse(
          (r) =>
            r.url().endsWith("/playback/" + session.sessionId) &&
            r.request().method() === "PUT" &&
            r.request().postDataJSON().endReason === "ended",
          { timeout: (song.durationSec + 90) * 1000 },
        );
        expect(ended.ok()).toBe(true);
        result.checkpoint = ended.request().postDataJSON();
        expect(result.checkpoint.playedSeconds).toBeGreaterThan(
          song.durationSec * 0.9,
        );
      } else {
        await expect
          .poll(
            async () =>
              Number(await bar.locator("progress").getAttribute("value")),
            { timeout: (step.seconds + 60) * 1000, intervals: [1000] },
          )
          .toBeGreaterThanOrEqual(step.seconds);
        if (step.mode === "skip") {
          const ended = page.waitForResponse(
            (r) =>
              r.url().endsWith("/playback/" + session.sessionId) &&
              r.request().method() === "PUT" &&
              r.request().postDataJSON().endReason === "skip",
          );
          await bar
            .getByRole("button", { name: "Next track", exact: true })
            .click();
          const saved = await ended;
          expect(saved.ok()).toBe(true);
          result.checkpoint = saved.request().postDataJSON();
        } else {
          const paused = page.waitForResponse(
            (r) =>
              r.url().endsWith("/playback/" + session.sessionId) &&
              r.request().method() === "PUT",
          );
          await bar.getByRole("button", { name: "Pause", exact: true }).click();
          const saved = await paused;
          expect(saved.ok()).toBe(true);
          result.checkpoint = saved.request().postDataJSON();
        }
      }
      await expect(bar.getByRole("alert")).toHaveCount(0);
    } finally {
      clearInterval(progress);
    }
  }
  await expect
    .poll(
      async () => {
        report.after = await (
          await page.request.get(baseURL + "/api/v1/recommendations")
        ).json();
        return report.after.source;
      },
      { timeout: 30000 },
    )
    .toBe("graph");
  const preferred = new Set(
    allGenres
      .filter((g: any) => report.favoriteGenres.includes(g.name))
      .map((g: any) => g.genreId),
  );
  report.topFive = report.after.items.slice(0, 5).map((song: any) => ({
    title: song.title,
    artists: song.artists.map((a: any) => a.name),
    genres: song.genres.map((g: any) => g.name),
    reason: song.reason,
    matchesTaste: song.genreIds.some((id: string) => preferred.has(id)),
  }));
  expect(report.topFive).toHaveLength(5);
  expect(report.topFive.every((s: any) => s.matchesTaste)).toBe(true);
  await page.getByRole("link", { name: "For you", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "A few discoveries for you" }),
  ).toBeVisible();
  await mkdir("tmp", { recursive: true });
  await page.screenshot({
    path: "tmp/demo-listener-recommendations.png",
    fullPage: true,
  });
  console.log(
    "Taste-matching recommendations:",
    JSON.stringify(report.topFive),
  );
} finally {
  report.finishedAt = new Date().toISOString();
  await mkdir("tmp", { recursive: true });
  await writeFile(
    "tmp/demo-listener-simulation.json",
    JSON.stringify(report, null, 2),
  );
  await browser.close();
}
