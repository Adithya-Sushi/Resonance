import { z } from "zod";
export const uuid = z.string().uuid();
export const text = z.string().trim().min(1).max(200);
export const status = z.enum(["active", "retired"]);
export const credentials = z.object({
  email: z
    .string()
    .email()
    .max(254)
    .transform((x) => x.trim().toLowerCase()),
  password: z.string().min(12).max(128),
});
export const register = credentials.extend({ displayName: text.max(80) });
export const profile = z.object({
  displayName: text.max(80),
  country: z.string().max(80),
  genreIds: z.array(uuid).max(20),
  recommendationOptIn: z.boolean(),
});
export const artistInput = z.object({
  name: text,
  bio: z.string().max(4000).default(""),
  country: z.string().max(80).default(""),
  genreIds: z.array(uuid).default([]),
  musicbrainzId: uuid.optional(),
});
export const albumInput = z.object({
  title: text,
  artistIds: z
    .array(uuid)
    .min(1)
    .max(20)
    .refine((x) => new Set(x).size === x.length, "Artist IDs must be unique"),
  releaseDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .refine(
      (x) =>
        !isNaN(Date.parse(x)) && new Date(x).toISOString().slice(0, 10) === x,
      "A valid calendar date is required",
    ),
  type: z.enum(["album", "single", "ep"]),
  musicbrainzId: uuid.optional(),
});
export const songInput = z.object({
  title: text,
  artistCredits: z
    .array(
      z.object({
        artistId: uuid,
        role: z.enum(["primary", "featured"]).default("primary"),
      }),
    )
    .min(1)
    .max(20)
    .refine(
      (x) => new Set(x.map((c) => c.artistId)).size === x.length,
      "Use one credit per artist",
    ),
  albumId: uuid,
  genreIds: z
    .array(uuid)
    .min(1)
    .max(8)
    .refine((x) => new Set(x).size === x.length, "Genre IDs must be unique"),
  durationSec: z.number().positive().max(14400),
  language: text.max(40),
  trackNumber: z.number().int().positive().default(1),
  discNumber: z.number().int().positive().default(1),
  media: z.object({
    provider: z.literal("youtube"),
    videoId: z.string().regex(/^[\w-]{11}$/),
  }),
  musicbrainzId: uuid.optional(),
});
export const playlistInput = z.object({
  name: text.max(100),
  description: z.string().max(1000).default(""),
  visibility: z.enum(["public", "private"]).default("private"),
});
export const entrySchema = z.object({
  entryId: uuid,
  songId: uuid,
  position: z.number().int().positive(),
  addedAt: z.string().datetime(),
});
export const playlistEdit = playlistInput
  .extend({
    version: z.number().int().positive(),
    tracks: z.array(entrySchema).max(500),
  })
  .superRefine((x, c) => {
    if (
      new Set(x.tracks.map((t) => t.entryId)).size !== x.tracks.length ||
      x.tracks.some((t, i) => t.position !== i + 1)
    )
      c.addIssue({
        code: "custom",
        message: "Entries must have unique IDs and consecutive positions",
      });
  });
export const telemetrySchema = z.object({
  seq: z.number().int().nonnegative(),
  playedSeconds: z.number().nonnegative().max(86400),
  coverageRanges: z
    .array(z.tuple([z.number().nonnegative(), z.number().nonnegative()]))
    .max(256),
  endReason: z.enum(["ended", "skip", "stopped", "interrupted"]).optional(),
});
export type Telemetry = z.infer<typeof telemetrySchema>;
export type Song = z.infer<typeof songInput> & {
  songId: string;
  status: "active" | "retired";
  version: number;
  artists?: { artistId: string; name: string }[];
  album?: { albumId: string; title: string; releaseDate: string };
  genres?: { genreId: string; name: string }[];
  reason?: string;
};
export type User = {
  userId: string;
  displayName: string;
  emailNormalized: string;
  roles: string[];
  country: string;
  preferences: { genreIds: string[] };
  privacy: { recommendationOptIn: boolean };
};
export function normalize(value: string) {
  return value.normalize("NFKC").trim().toLowerCase();
}
export function escapeRegex(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
export function youtubeId(value: string): string | null {
  if (/^[\w-]{11}$/.test(value)) return value;
  try {
    const u = new URL(value);
    if (!["https:", "http:"].includes(u.protocol)) return null;
    const host = u.hostname.replace(/^www\./, "");
    let id: string | null = null;
    if (host === "youtu.be") id = u.pathname.slice(1).split("/")[0];
    if (["youtube.com", "m.youtube.com", "youtube-nocookie.com"].includes(host))
      id =
        u.searchParams.get("v") ||
        u.pathname.match(/^\/(?:embed|shorts)\/([\w-]+)/)?.[1] ||
        null;
    return id && /^[\w-]{11}$/.test(id) ? id : null;
  } catch {
    return null;
  }
}
export function mergeRanges(
  ranges: number[][],
  duration: number,
): [number, number][] {
  const sorted = ranges
    .map(([a, b]) => [Math.max(0, a), Math.min(duration, b)])
    .filter(([a, b]) => b > a)
    .sort((a, b) => a[0] - b[0]);
  const out: [number, number][] = [];
  for (const [a, b] of sorted) {
    const last = out.at(-1);
    if (last && a <= last[1] + 0.05) last[1] = Math.max(last[1], b);
    else out.push([a, b]);
  }
  return out;
}
export function coverage(ranges: number[][], duration: number) {
  return Math.min(
    1,
    mergeRanges(ranges, duration).reduce((n, [a, b]) => n + b - a, 0) /
      duration,
  );
}
export function qualified(played: number, duration: number) {
  return played >= Math.min(30, duration / 2);
}
export function validateTelemetry(
  previous: {
    seq: number;
    playedSeconds: number;
    coverageRanges: number[][];
    durationSecSnapshot: number;
    lastCheckpointAt: Date;
  },
  next: Telemetry,
  now: Date,
) {
  if (next.seq < previous.seq) throw new Error("Stale checkpoint");
  const merged = mergeRanges(next.coverageRanges, previous.durationSecSnapshot);
  if (
    next.coverageRanges.some(
      ([a, b]) => b < a || b > previous.durationSecSnapshot + 0.5,
    )
  )
    throw new Error("Invalid coverage interval");
  const elapsed = Math.max(
    0,
    (now.getTime() - previous.lastCheckpointAt.getTime()) / 1000,
  );
  if (
    next.playedSeconds < previous.playedSeconds ||
    next.playedSeconds - previous.playedSeconds > elapsed + 3
  )
    throw new Error("Implausible listening time");
  const length = merged.reduce((n, [a, b]) => n + b - a, 0);
  if (length > next.playedSeconds + 1)
    throw new Error("Coverage exceeds listening time");
  for (const [a, b] of previous.coverageRanges)
    if (!merged.some(([c, d]) => c <= a + 0.05 && d >= b - 0.05))
      throw new Error("Coverage cannot decrease");
  return {
    coverageRanges: merged,
    completionRatio: coverage(merged, previous.durationSecSnapshot),
  };
}
export function isoDuration(value: string) {
  const m = value.match(/^PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+(?:\.\d+)?)S)?$/);
  return m
    ? Number(m[1] || 0) * 3600 + Number(m[2] || 0) * 60 + Number(m[3] || 0)
    : 0;
}
