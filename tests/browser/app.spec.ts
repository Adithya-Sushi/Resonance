import { test, expect, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
async function login(page: Page, admin = false) {
  await page.goto("/");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await page
    .getByLabel("Email", { exact: true })
    .fill(admin ? "admin@resonance.local" : "listener@resonance.local");
  await page.getByLabel("Password", { exact: true }).fill("ResonanceDemo!2026");
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Sign in", exact: true })
    .click();
  await expect(page.getByRole("button", { name: "Sign out" })).toBeVisible();
}
test("discovery and login meet automated WCAG checks and modal keyboard behavior", async ({
  page,
}) => {
  await page.goto("/");
  await expect(
    page.getByRole("heading", { name: "Find your frequency." }),
  ).toBeVisible();
  let audit = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
    .analyze();
  expect(
    audit.violations.map((v) => ({
      id: v.id,
      nodes: v.nodes.map((n) => ({
        target: n.target,
        reason: n.failureSummary,
      })),
    })),
  ).toEqual([]);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Close", exact: true }),
  ).toBeFocused();
  await page.keyboard.press("Shift+Tab");
  expect(
    await page
      .getByRole("dialog")
      .evaluate((el) => el.contains(document.activeElement)),
  ).toBe(true);
  audit = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
    .analyze();
  expect(
    audit.violations.map((v) => ({
      id: v.id,
      nodes: v.nodes.map((n) => ({
        target: n.target,
        reason: n.failureSummary,
      })),
    })),
  ).toEqual([]);
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Sign in", exact: true }),
  ).toBeFocused();
});
test("discovery and prefix search work without horizontal overflow", async ({
  page,
}) => {
  await page.goto("/");
  await expect(
    page.getByRole("heading", { name: "Find your frequency." }),
  ).toBeVisible();
  await page.getByRole("link", { name: "Explore", exact: true }).click();
  await page.getByLabel("Search catalog").fill("queen");
  await expect(
    page.locator("strong").filter({ hasText: "Bohemian Rhapsody" }),
  ).toBeVisible();
  await expect(
    page.locator("strong").filter({ hasText: "Counting Stars" }),
  ).toHaveCount(0);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
});
test("listener creates playlist, adds repeated song and sees saved history", async ({
  page,
}) => {
  await login(page);
  await page.getByRole("link", { name: "Your library", exact: true }).click();
  const name = "Browser test " + Date.now();
  await page.getByLabel("New playlist name").fill(name);
  await page
    .getByRole("button", { name: "Create playlist", exact: true })
    .click();
  await expect(page.getByRole("heading", { name })).toBeVisible();
  await page.getByRole("link", { name: "Explore", exact: true }).click();
  await page.getByLabel("Search catalog").fill("faded");
  for (let i = 0; i < 2; i++) {
    await page
      .getByRole("button", { name: "Add Faded to playlist", exact: true })
      .click();
    await page.getByRole("button", { name, exact: true }).click();
    await expect(
      page.getByRole("heading", { name: "Add to playlist", exact: true }),
    ).toHaveCount(0);
  }
  await page.getByRole("link", { name: "Your library", exact: true }).click();
  await page
    .getByRole("link")
    .filter({ has: page.getByRole("heading", { name, exact: true }) })
    .click();
  await expect(
    page.locator("strong").filter({ hasText: /^Faded$/ }),
  ).toHaveCount(2);
  await page
    .getByRole("link", { name: "Recently played", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Recently played", exact: true }),
  ).toBeVisible();
});
test("admin import clearly explains missing API configuration", async ({
  page,
}) => {
  await login(page, true);
  await page.getByRole("link", { name: "Admin studio", exact: true }).click();
  await page.getByRole("link", { name: "Import music", exact: true }).click();
  await page.getByLabel("YouTube links").fill("https://youtu.be/dQw4w9WgXcQ");
  await page
    .getByRole("button", { name: "Prepare import", exact: true })
    .click();
  await expect(
    page.getByText("Configure YOUTUBE_API_KEY in .env to import from YouTube", {
      exact: true,
    }),
  ).toBeVisible();
});
test("controlled player starts, remains mounted across routes, and checkpoints", async ({
  page,
}) => {
  await page.route("https://www.youtube.com/iframe_api", (route) =>
    route.fulfill({
      contentType: "application/javascript",
      body: `window.YT={Player:class{constructor(id,options){this.state=2;this.t=0;this.o=options;this.el=document.getElementById(id);this.el.setAttribute('data-test-player','ready');setTimeout(()=>options.events.onReady(),10);setInterval(()=>{if(this.state===1)this.t+=.25},250)}setVolume(){}getCurrentTime(){return this.t}getPlayerState(){return this.state}getPlaybackRate(){return 1}setPlaybackRate(){}loadVideoById(){this.t=0;this.playVideo()}playVideo(){this.state=1;this.o.events.onStateChange({data:1})}pauseVideo(){this.state=2;this.o.events.onStateChange({data:2})}}};window.onYouTubeIframeAPIReady();`,
    }),
  );
  await login(page);
  await page
    .getByRole("button", { name: "Play Faded", exact: true })
    .first()
    .click();
  await expect(
    page.getByRole("button", { name: "Pause", exact: true }),
  ).toBeVisible();
  await page.getByRole("link", { name: "Your library", exact: true }).click();
  await expect(page.locator('[data-test-player="ready"]')).toHaveCount(1);
  await expect(page.locator(".video-frame")).toBeInViewport({ ratio: 1 });
  const response = page.waitForResponse(
    (r) => r.url().includes("/playback/") && r.request().method() === "PUT",
  );
  await page.getByRole("button", { name: "Pause", exact: true }).click();
  expect((await response).status()).toBe(200);
});
