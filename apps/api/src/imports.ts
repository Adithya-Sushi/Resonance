import { Router } from "express";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import {
  youtubeId,
  isoDuration,
  uuid,
  normalize,
  songInput,
  albumInput,
  artistInput,
} from "@resonance/shared";
import { collection, transaction, outbox } from "./db.js";
import { config } from "./config.js";
import { assert, HttpError } from "./errors.js";
import { refs } from "./catalog.js";
const draftSchema = z.object({
  title: z.string().trim().max(200),
  artistName: z.string().trim().max(200),
  artistId: uuid.optional(),
  artistMusicbrainzId: uuid.optional(),
  additionalArtists: z
    .array(
      z.object({
        name: z.string().trim().min(1).max(200),
        artistId: uuid.optional(),
        musicbrainzId: uuid.optional(),
        role: z.enum(["primary", "featured"]).default("featured"),
      }),
    )
    .max(19)
    .default([]),
  albumTitle: z.string().trim().max(200),
  albumId: uuid.optional(),
  albumMusicbrainzId: uuid.optional(),
  musicbrainzId: uuid.optional(),
  releaseDate: z.string().max(10),
  type: z.enum(["album", "single", "ep"]).default("album"),
  genreIds: z.array(uuid).max(8),
  language: z.string().max(40),
  durationSec: z.number().nonnegative().max(14400),
  trackNumber: z.number().int().positive().default(1),
  discNumber: z.number().int().positive().default(1),
});
export function importRouter() {
  const r = Router();
  r.get("/", async (req, res) =>
    res.json(
      await collection("import_jobs")
        .find({}, { projection: { rows: 0 } })
        .sort({ createdAt: -1 })
        .limit(30)
        .toArray(),
    ),
  );
  r.post("/", async (req, res) => {
    assert(
      config.youtubeKey,
      503,
      "Configure YOUTUBE_API_KEY in .env to import from YouTube",
    );
    const { input } = z
      .object({ input: z.string().min(1).max(20000) })
      .parse(req.body);
    const sources = input.split(/[\s,]+/).filter(Boolean);
    const videoIds: string[] = [],
      playlistIds: string[] = [];
    for (const source of sources) {
      const id = youtubeId(source);
      if (id) {
        videoIds.push(id);
        continue;
      }
      let list: string | null = null;
      try {
        const u = new URL(source);
        if (
          ["youtube.com", "www.youtube.com", "m.youtube.com"].includes(
            u.hostname,
          )
        )
          list = u.searchParams.get("list");
      } catch {}
      assert(
        list && /^[\w-]{10,100}$/.test(list),
        400,
        `Invalid YouTube source: ${source.slice(0, 80)}`,
      );
      playlistIds.push(list);
    }
    const job = {
      jobId: randomUUID(),
      createdBy: req.user.userId,
      createdAt: new Date(),
      updatedAt: new Date(),
      status: "queued",
      videoIds: [...new Set(videoIds)],
      playlistIds: [...new Set(playlistIds)],
      playlistCursor: 0,
      pageToken: null,
      discoveryComplete: playlistIds.length === 0,
      rows: [],
      errors: [],
    };
    await collection("import_jobs").insertOne(job);
    res.status(202).json(job);
  });
  r.get("/:id", async (req, res) => {
    const job = await collection("import_jobs").findOne({
      jobId: uuid.parse(req.params.id),
    });
    assert(job, 404, "Import not found");
    res.json(job);
  });
  r.patch("/:id/rows/:videoId", async (req, res) => {
    const draft = draftSchema.parse(req.body);
    const result = await collection("import_jobs").updateOne(
      {
        jobId: uuid.parse(req.params.id),
        rows: {
          $elemMatch: {
            videoId: req.params.videoId,
            status: { $ne: "published" },
          },
        },
      },
      {
        $set: {
          "rows.$.draft": draft,
          "rows.$.reviewed": true,
          updatedAt: new Date(),
        },
      },
    );
    assert(result.modifiedCount, 409, "Row missing or already published");
    res.json({ ok: true });
  });
  r.post("/:id/rows/:videoId/match", async (req, res) => {
    const jobId = uuid.parse(req.params.id);
    const { recordingId, releaseId } = z
      .object({ recordingId: uuid, releaseId: uuid.optional() })
      .parse(req.body);
    const job = await collection("import_jobs").findOne({
      jobId,
      rows: { $elemMatch: { videoId: req.params.videoId, status: "ready" } },
    });
    assert(job, 404, "Editable import row not found");
    const metadata = await recordingDetails(recordingId, releaseId);
    await collection("import_jobs").updateOne(
      { jobId, "rows.videoId": req.params.videoId },
      {
        $set: {
          "rows.$.metadataLookup": {
            recordingId,
            releaseId,
            fetchedAt: metadata.fetchedAt,
            source: "musicbrainz",
          },
        },
      },
    );
    res.json(metadata);
  });
  r.post("/:id/retry", async (req, res) => {
    const job = await collection("import_jobs").findOne({
      jobId: uuid.parse(req.params.id),
    });
    assert(job, 404, "Import not found");
    await collection("import_jobs").updateOne(
      { jobId: job.jobId },
      {
        $set: {
          status: "queued",
          error: null,
          rows: job.rows.map((row: any) =>
            ["error", "expired", "unavailable"].includes(row.status) ||
            (row.warning && !row.reviewed)
              ? { ...row, status: "retry" }
              : row,
          ),
          updatedAt: new Date(),
        },
      },
    );
    res.status(202).json({ ok: true });
  });
  r.post("/:id/publish", async (req, res) => {
    const { videoIds } = z
      .object({
        videoIds: z
          .array(z.string().regex(/^[\w-]{11}$/))
          .min(1)
          .max(200),
      })
      .parse(req.body);
    const jobId = uuid.parse(req.params.id);
    const results = [];
    for (const videoId of [...new Set(videoIds)]) {
      try {
        const songId = await publishRow(jobId, videoId);
        results.push({ videoId, status: "published", songId });
      } catch (e) {
        await collection("import_jobs").updateOne(
          { jobId, "rows.videoId": videoId },
          {
            $set: {
              "rows.$.publishError": (e as Error).message,
              updatedAt: new Date(),
            },
          },
        );
        results.push({ videoId, status: "error", error: (e as Error).message });
      }
    }
    res.json({ results });
  });
  return r;
}
export async function youtube(
  path: string,
  params: Record<string, string>,
  fetcher: typeof fetch = fetch,
) {
  assert(config.youtubeKey, 503, "YouTube API key is not configured");
  const u = new URL(`https://www.googleapis.com/youtube/v3/${path}`);
  for (const [k, v] of Object.entries({ ...params, key: config.youtubeKey }))
    u.searchParams.set(k, v);
  let r: Response;
  try {
    r = await fetcher(u, { signal: AbortSignal.timeout(15000) });
  } catch {
    throw new Error("YouTube request timed out or network unavailable");
  }
  if (!r.ok) {
    const payload = (await r.json().catch(() => ({}))) as any;
    const reason = payload.error?.errors?.[0]?.reason;
    throw new Error(
      reason === "quotaExceeded"
        ? "YouTube daily quota exhausted; retry after reset"
        : `YouTube request failed (${r.status})`,
    );
  }
  return r.json() as Promise<any>;
}
let mbChain = Promise.resolve();
export function musicbrainz(
  endpoint: string,
  fetcher: typeof fetch = fetch,
): Promise<any> {
  const run = mbChain.then(async () => {
    // A shared lease serializes API lookups and worker searches across processes.
    const limits = collection("provider_limits"),
      owner = randomUUID();
    await limits.updateOne(
      { _id: "musicbrainz" as any },
      { $setOnInsert: { leaseUntil: new Date(0) } },
      { upsert: true },
    );
    const deadline = Date.now() + 30000;
    while (
      !(await limits.findOneAndUpdate(
        { _id: "musicbrainz" as any, leaseUntil: { $lte: new Date() } },
        { $set: { owner, leaseUntil: new Date(Date.now() + 20000) } },
      ))
    ) {
      assert(
        Date.now() < deadline,
        429,
        "Metadata lookup is busy; try again shortly",
      );
      await new Promise((r) => setTimeout(r, 250));
    }
    try {
      const r = await fetcher(`https://musicbrainz.org/ws/2/${endpoint}`, {
        headers: {
          "User-Agent": `Resonance/1.0 (${process.env.MUSICBRAINZ_CONTACT || "local-student-project"})`,
          Accept: "application/json",
        },
        signal: AbortSignal.timeout(15000),
      });
      if (!r.ok)
        throw new Error(
          `MusicBrainz unavailable (${r.status}); retry metadata lookup or complete manually`,
        );
      return await r.json();
    } finally {
      await limits.updateOne(
        { _id: "musicbrainz" as any, owner },
        {
          $set: { leaseUntil: new Date(Date.now() + 1050) },
          $unset: { owner: "" },
        },
      );
    }
  });
  mbChain = run.then(
    () => {},
    () => {},
  );
  return run;
}
export async function recordingDetails(
  recordingId: string,
  releaseId?: string,
) {
  const recording = await musicbrainz(
    `recording/${uuid.parse(recordingId)}?inc=genres&fmt=json`,
  );
  const release = releaseId
    ? await musicbrainz(
        `release/${uuid.parse(releaseId)}?inc=recordings+release-groups+genres&fmt=json`,
      )
    : null;
  const positions = (release?.media || []).flatMap((medium: any) =>
    (medium.tracks || [])
      .filter((track: any) => track.recording?.id === recordingId)
      .map((track: any) => ({
        trackNumber: track.position,
        discNumber: medium.position,
      })),
  );
  assert(
    !release || positions.length,
    409,
    "This recording does not appear on the selected release",
  );
  const suggestedGenres: string[] = [
    ...new Set<string>(
      [...(recording.genres || []), ...(release?.genres || [])].map(
        (g: any) => g.name,
      ),
    ),
  ];
  const genres = await collection("genres")
    .find({ status: "active" })
    .toArray();
  return {
    suggestedGenres,
    genreIds: genres
      .filter((g) =>
        suggestedGenres.some((name) => normalize(name) === normalize(g.name)),
      )
      .map((g) => g.genreId),
    positions,
    ...(positions.length === 1 ? positions[0] : {}),
    fetchedAt: new Date(),
    releaseDate: release?.date?.length === 10 ? release.date : undefined,
  };
}
export async function recordingSuggestions(title: string) {
  const cleaned = title
    .replace(
      /\b(official\s+(music\s+)?video|official\s+audio|lyrics|lyric\s+video)\b/gi,
      "",
    )
    .replace(/[()[\]]/g, " ")
    .trim();
  const data = await musicbrainz(
    `recording?query=${encodeURIComponent(cleaned)}&fmt=json&limit=5`,
  );
  return (data.recordings || []).map((x: any) => ({
    recordingId: x.id,
    title: x.title,
    length: x.length,
    disambiguation: x.disambiguation || "",
    artists: (x["artist-credit"] || [])
      .filter((a: any) => a.artist)
      .map((a: any) => ({ id: a.artist.id, name: a.artist.name })),
    releases: (x.releases || []).slice(0, 5).map((a: any) => ({
      id: a.id,
      title: a.title,
      date: a.date || "",
      country: a.country || "",
      type: a["release-group"]?.["primary-type"] || "Album",
    })),
    score: x.score,
  }));
}
export async function processImport() {
  const job = await collection("import_jobs").findOneAndUpdate(
    { status: { $in: ["queued", "fetching"] } },
    { $set: { status: "fetching", updatedAt: new Date() } },
    { sort: { createdAt: 1 }, returnDocument: "after" },
  );
  if (!job) return false;
  try {
    if (!job.discoveryComplete) {
      const playlistId = job.playlistIds[job.playlistCursor];
      const data = await youtube("playlistItems", {
        part: "contentDetails",
        playlistId,
        maxResults: "50",
        ...(job.pageToken ? { pageToken: job.pageToken } : {}),
      });
      const videoIds = [
        ...new Set([
          ...job.videoIds,
          ...data.items.map((x: any) => x.contentDetails.videoId),
        ]),
      ];
      assert(
        videoIds.length <= 1000,
        400,
        "Import limited to 1,000 videos per job",
      );
      const cursor = job.playlistCursor + (data.nextPageToken ? 0 : 1);
      await collection("import_jobs").updateOne(
        { jobId: job.jobId },
        {
          $set: {
            videoIds,
            playlistCursor: cursor,
            pageToken: data.nextPageToken || null,
            discoveryComplete: cursor >= job.playlistIds.length,
          },
        },
      );
      return true;
    }
    const existing = new Set(
      job.rows
        .filter((x: any) => x.status !== "retry")
        .map((x: any) => x.videoId),
    );
    const ids = job.videoIds
      .filter((x: string) => !existing.has(x))
      .slice(0, 10);
    if (!ids.length) {
      await collection("import_jobs").updateOne(
        { jobId: job.jobId },
        { $set: { status: "review", updatedAt: new Date() } },
      );
      return true;
    }
    const data = await youtube("videos", {
      part: "snippet,contentDetails,status",
      id: ids.join(","),
    });
    for (const videoId of ids) {
      const previousRow = job.rows.find((x: any) => x.videoId === videoId);
      const video = data.items.find((x: any) => x.id === videoId);
      const duplicate = await collection("songs").findOne({
        "media.videoId": videoId,
      });
      let row: any = {
        videoId,
        status: "ready",
        reviewed: false,
        suggestions: [],
      };
      if (duplicate)
        row = { ...row, status: "duplicate", songId: duplicate.songId };
      else if (
        !video ||
        !video.status.embeddable ||
        video.snippet.liveBroadcastContent !== "none" ||
        !isoDuration(video.contentDetails.duration)
      )
        row = {
          ...row,
          status: "unavailable",
          error: "Video is missing, live, or cannot be embedded",
        };
      else {
        row.youtube = {
          title: video.snippet.title,
          thumbnailUrl: video.snippet.thumbnails?.medium?.url,
          durationSec: isoDuration(video.contentDetails.duration),
          channelTitle: video.snippet.channelTitle,
          embeddable: true,
          fetchedAt: new Date(),
          expiresAt: new Date(Date.now() + 29 * 86400000),
        };
        row.draft = {
          title: "",
          artistName: "",
          albumTitle: "",
          releaseDate: "",
          type: "album",
          genreIds: [],
          language: "",
          durationSec: row.youtube.durationSec,
          trackNumber: 1,
          discNumber: 1,
        };
        try {
          row.suggestions = await recordingSuggestions(video.snippet.title);
          row.suggestionsFetchedAt = new Date();
        } catch (e) {
          row.warning = (e as Error).message;
        }
      }
      if (previousRow?.draft) {
        row.draft = previousRow.draft;
        row.reviewed = previousRow.reviewed || false;
        if (previousRow.metadataLookup)
          row.metadataLookup = previousRow.metadataLookup;
      }
      await collection("import_jobs").updateOne({ jobId: job.jobId }, [
        {
          $set: {
            rows: {
              $concatArrays: [
                {
                  $filter: {
                    input: "$rows",
                    as: "row",
                    cond: { $ne: ["$$row.videoId", videoId] },
                  },
                },
                { $literal: [row] },
              ],
            },
            updatedAt: new Date(),
          },
        },
      ]);
    }
    return true;
  } catch (e) {
    await collection("import_jobs").updateOne(
      { jobId: job.jobId },
      {
        $set: {
          status: "failed",
          error: (e as Error).message,
          updatedAt: new Date(),
        },
      },
    );
    return true;
  }
}
export async function publishRow(jobId: string, videoId: string) {
  return transaction(async (s) => {
    const job = await collection("import_jobs").findOne(
      { jobId },
      { session: s },
    );
    const row = job?.rows.find((x: any) => x.videoId === videoId);
    assert(row, 404, "Import row missing");
    if (row.status === "published") return row.songId;
    assert(
      row.status === "ready" && row.reviewed,
      400,
      "Review and save this row before publishing",
    );
    assert(
      row.youtube?.expiresAt > new Date(),
      409,
      "Video metadata expired; re-import before publishing",
    );
    const duplicate = await collection("songs").findOne(
      { "media.videoId": videoId },
      { session: s },
    );
    if (duplicate) {
      await collection("import_jobs").updateOne(
        { jobId, "rows.videoId": videoId },
        {
          $set: {
            "rows.$.status": "published",
            "rows.$.songId": duplicate.songId,
          },
        },
        { session: s },
      );
      return duplicate.songId;
    }
    const d = draftSchema.parse(row.draft);
    let artistId = d.artistId;
    let albumId = d.albumId;
    if (!artistId && d.artistMusicbrainzId)
      artistId = (
        await collection("artists").findOne(
          { musicbrainzId: d.artistMusicbrainzId, status: "active" },
          { session: s },
        )
      )?.artistId;
    if (!artistId) {
      const a = artistInput.parse({
        name: d.artistName,
        genreIds: d.genreIds,
        musicbrainzId: d.artistMusicbrainzId,
      });
      artistId = randomUUID();
      await collection("artists").insertOne(
        {
          ...a,
          artistId,
          searchName: normalize(a.name),
          status: "active",
          version: 1,
          createdAt: new Date(),
        },
        { session: s },
      );
      await outbox(s, "artists", artistId);
    }
    const credits: { artistId: string; role: "primary" | "featured" }[] = [
      { artistId: artistId!, role: "primary" },
    ];
    for (const extra of d.additionalArtists) {
      let extraId = extra.artistId;
      if (!extraId && extra.musicbrainzId)
        extraId = (
          await collection("artists").findOne(
            { musicbrainzId: extra.musicbrainzId, status: "active" },
            { session: s },
          )
        )?.artistId;
      if (!extraId) {
        extraId = randomUUID();
        await collection("artists").insertOne(
          {
            artistId: extraId,
            name: extra.name,
            searchName: normalize(extra.name),
            ...(extra.musicbrainzId
              ? { musicbrainzId: extra.musicbrainzId }
              : {}),
            genreIds: d.genreIds,
            status: "active",
            version: 1,
            createdAt: new Date(),
          },
          { session: s },
        );
        await outbox(s, "artists", extraId);
      }
      credits.push({ artistId: extraId!, role: extra.role });
    }
    await refs(
      "artists",
      "artistId",
      credits.map((c) => c.artistId),
      s,
    );
    if (!albumId && d.albumMusicbrainzId)
      albumId = (
        await collection("albums").findOne(
          { musicbrainzId: d.albumMusicbrainzId, status: "active" },
          { session: s },
        )
      )?.albumId;
    if (!albumId) {
      const a = albumInput.parse({
        title: d.albumTitle,
        artistIds: credits.map((c) => c.artistId),
        releaseDate: d.releaseDate,
        type: d.type,
        musicbrainzId: d.albumMusicbrainzId,
      });
      albumId = randomUUID();
      await collection("albums").insertOne(
        {
          ...a,
          releaseDate: new Date(a.releaseDate),
          albumId,
          searchTitle: normalize(a.title),
          status: "active",
          version: 1,
          createdAt: new Date(),
        },
        { session: s },
      );
      await outbox(s, "albums", albumId);
    }
    await refs("albums", "albumId", [albumId!], s);
    await refs("genres", "genreId", d.genreIds, s);
    const song = songInput.parse({
      title: d.title,
      artistCredits: credits,
      albumId,
      genreIds: d.genreIds,
      durationSec: row.youtube.durationSec,
      language: d.language,
      trackNumber: d.trackNumber,
      discNumber: d.discNumber,
      media: { provider: "youtube", videoId },
      musicbrainzId: d.musicbrainzId,
    });
    const songId = randomUUID();
    await collection("songs").insertOne(
      {
        ...song,
        songId,
        searchTitle: normalize(song.title),
        status: "active",
        version: 1,
        createdAt: new Date(),
        updatedAt: new Date(),
        youtubeMetadata: row.youtube,
        provenance: {
          catalog: "admin-reviewed",
          recordingId: d.musicbrainzId || null,
          importJobId: jobId,
          reviewedAt: new Date(),
          musicbrainz:
            row.metadataLookup ||
            (row.suggestionsFetchedAt
              ? { source: "musicbrainz", fetchedAt: row.suggestionsFetchedAt }
              : null),
        },
      },
      { session: s },
    );
    await outbox(s, "songs", songId);
    await collection("import_jobs").updateOne(
      { jobId, "rows.videoId": videoId },
      {
        $set: { "rows.$.status": "published", "rows.$.songId": songId },
        $unset: { "rows.$.publishError": "" },
      },
      { session: s },
    );
    return songId;
  });
}
export async function refreshYoutubeMetadata() {
  const expiring = await collection("songs")
    .find({
      "youtubeMetadata.expiresAt": { $lte: new Date(Date.now() + 86400000) },
    })
    .limit(50)
    .toArray();
  if (expiring.length && config.youtubeKey) {
    try {
      const data = await youtube("videos", {
        part: "snippet,contentDetails,status",
        id: expiring.map((x) => x.media.videoId).join(","),
      });
      for (const song of expiring) {
        const video = data.items.find((x: any) => x.id === song.media.videoId);
        if (video)
          await collection("songs").updateOne(
            { songId: song.songId },
            {
              $set: {
                youtubeMetadata: {
                  title: video.snippet.title,
                  thumbnailUrl: video.snippet.thumbnails?.medium?.url,
                  durationSec: isoDuration(video.contentDetails.duration),
                  embeddable: video.status.embeddable,
                  fetchedAt: new Date(),
                  expiresAt: new Date(Date.now() + 29 * 86400000),
                },
              },
            },
          );
        else
          await collection("songs").updateOne(
            { songId: song.songId },
            {
              $unset: { youtubeMetadata: "" },
              $set: { playbackAvailability: "unavailable" },
            },
          );
      }
    } catch {
      /* Expired data is removed below even when provider refresh fails. */
    }
  }
  await collection("songs").updateMany(
    { "youtubeMetadata.expiresAt": { $lte: new Date() } },
    { $unset: { youtubeMetadata: "" } },
  );
  await collection("import_jobs").updateMany(
    { "rows.youtube.expiresAt": { $lte: new Date() } },
    {
      $unset: { "rows.$[row].youtube": "", "rows.$[row].suggestions": "" },
      $set: { "rows.$[row].status": "expired" },
    },
    {
      arrayFilters: [
        {
          "row.youtube.expiresAt": { $lte: new Date() },
          "row.status": { $ne: "published" },
        },
      ],
    },
  );
  // Published drafts must not retain expired provider cache either.
  await collection("import_jobs").updateMany(
    { "rows.youtube.expiresAt": { $lte: new Date() } },
    { $unset: { "rows.$[row].youtube": "", "rows.$[row].suggestions": "" } },
    { arrayFilters: [{ "row.youtube.expiresAt": { $lte: new Date() } }] },
  );
}
