import { describe, it, expect } from "vitest";
import {
  youtubeId,
  mergeRanges,
  coverage,
  qualified,
  validateTelemetry,
  playlistEdit,
  isoDuration,
  escapeRegex,
} from "../packages/shared/src/index.js";
import { seedData, seedId } from "../apps/api/src/seed-data.js";
import { buildProjection } from "../apps/worker/src/projection.js";
describe("YouTube input", () => {
  it.each([
    "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
    "https://youtu.be/dQw4w9WgXcQ",
    "https://www.youtube.com/embed/dQw4w9WgXcQ",
    "dQw4w9WgXcQ",
  ])("parses %s", (v) => expect(youtubeId(v)).toBe("dQw4w9WgXcQ"));
  it.each([
    "https://evil.test/watch?v=dQw4w9WgXcQ",
    "javascript:alert(1)",
    "not a video",
    "https://youtube.com.evil.test/watch?v=dQw4w9WgXcQ",
  ])("rejects %s", (v) => expect(youtubeId(v)).toBeNull());
  it("converts durations", () => expect(isoDuration("PT1H2M3S")).toBe(3723));
});
describe("Listening accounting", () => {
  it("merges repeat coverage without increasing unique time", () =>
    expect(
      mergeRanges(
        [
          [0, 10],
          [5, 20],
          [30, 40],
          [15, 25],
        ],
        100,
      ),
    ).toEqual([
      [0, 25],
      [30, 40],
    ]));
  it("seek to end is not completion", () =>
    expect(coverage([[190, 200]], 200)).toBe(0.05));
  it("bounds completion", () => expect(coverage([[0, 400]], 200)).toBe(1));
  it("qualifies short and ordinary tracks", () => {
    expect(qualified(10, 20)).toBe(true);
    expect(qualified(29, 200)).toBe(false);
    expect(qualified(30, 200)).toBe(true);
  });
  const old = {
    seq: 1,
    playedSeconds: 10,
    coverageRanges: [[0, 10]],
    durationSecSnapshot: 200,
    lastCheckpointAt: new Date(0),
  };
  it("rejects forged time", () =>
    expect(() =>
      validateTelemetry(
        old,
        { seq: 2, playedSeconds: 100, coverageRanges: [[0, 100]] },
        new Date(1000),
      ),
    ).toThrow("Implausible"));
  it("rejects lost previous coverage", () =>
    expect(() =>
      validateTelemetry(
        old,
        { seq: 2, playedSeconds: 20, coverageRanges: [[30, 40]] },
        new Date(10000),
      ),
    ).toThrow("decrease"));
  it("allows listening replay beyond duration", () =>
    expect(
      validateTelemetry(
        { ...old, playedSeconds: 200, coverageRanges: [[0, 200]] },
        { seq: 2, playedSeconds: 210, coverageRanges: [[0, 200]] },
        new Date(10000),
      ).completionRatio,
    ).toBe(1));
  it("rejects excess coverage", () =>
    expect(() =>
      validateTelemetry(
        old,
        { seq: 2, playedSeconds: 15, coverageRanges: [[0, 100]] },
        new Date(10000),
      ),
    ).toThrow("Coverage exceeds"));
});
describe("Playlists", () => {
  const row = {
      entryId: seedId("entry"),
      songId: seedId("song"),
      position: 1,
      addedAt: new Date().toISOString(),
    },
    base = { name: "Mix", visibility: "private", version: 1, tracks: [row] };
  it("allows repeated songs under distinct entries", () =>
    expect(
      playlistEdit.safeParse({
        ...base,
        tracks: [row, { ...row, entryId: seedId("second"), position: 2 }],
      }).success,
    ).toBe(true));
  it("rejects duplicate entry identity", () =>
    expect(
      playlistEdit.safeParse({
        ...base,
        tracks: [row, { ...row, position: 2 }],
      }).success,
    ).toBe(false));
  it("rejects position gaps", () =>
    expect(
      playlistEdit.safeParse({ ...base, tracks: [{ ...row, position: 2 }] })
        .success,
    ).toBe(false));
  it("allows empty playlist", () =>
    expect(playlistEdit.safeParse({ ...base, tracks: [] }).success).toBe(true));
  it("escapes regex search", () =>
    expect(new RegExp("^" + escapeRegex("a.*")).test("aHello")).toBe(false));
});
describe("Deterministic database fixtures", () => {
  const data = seedData(true, "hash", new Date("2026-09-18"));
  const graph = buildProjection(data, new Date("2026-09-18"));
  it("has exact authoritative and graph counts", () => {
    expect(Object.values(data).reduce((n, x) => n + x.length, 0)).toBe(808);
    expect(Object.values(graph.nodes).reduce((n, x) => n + x.length, 0)).toBe(
      228,
    );
    expect(Object.values(graph.edges).reduce((n, x) => n + x.length, 0)).toBe(
      1260,
    );
    expect(graph.edges.LISTENED_TO).toHaveLength(350);
  });
  it("keeps a cold-start listener", () =>
    expect(
      data.playback_sessions.some((s) => s.userId === data.users[19].userId),
    ).toBe(false));
  it("does not make fixture songs playable", () =>
    expect(data.songs.every((s) => s.media.provider === "fixture")).toBe(true));
  it("excludes private playlists and opted-out users", () => {
    const changed = structuredClone(data);
    changed.users[0].privacy.recommendationOptIn = false;
    changed.playlists[1].visibility = "private";
    const p = buildProjection(changed);
    expect(p.nodes.User).toHaveLength(19);
    expect(
      p.nodes.Playlist.some(
        (x) => x.playlistId === changed.playlists[1].playlistId,
      ),
    ).toBe(false);
    expect(
      p.edges.LISTENED_TO.some((x) => x.userId === changed.users[0].userId),
    ).toBe(false);
  });
  it("counts one recent play rather than 101 lifetime plays", () => {
    const d = structuredClone(data),
      session = d.playback_sessions.find((s) => s.endReason !== "skip")!;
    d.playback_sessions = Array.from({ length: 101 }, (_, i) => ({
      ...session,
      playedSeconds: 200,
      durationSecSnapshot: 200,
      startedAt: new Date(i === 100 ? "2026-09-17" : "2020-01-01"),
    }));
    const p = buildProjection(d, new Date("2026-09-18"));
    expect(p.edges.LISTENED_TO[0].playCount).toBe(101);
    expect(p.edges.LISTENED_TO[0].recentPlayCount).toBe(1);
  });
  it("projection is retry-safe", () =>
    expect(buildProjection(data, new Date("2026-09-18"))).toEqual(graph));
});
