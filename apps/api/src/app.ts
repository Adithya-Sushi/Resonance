import express, {
  type Request,
  type Response,
  type NextFunction,
} from "express";
import session from "express-session";
import MongoStore from "connect-mongo";
import helmet from "helmet";
import { rateLimit } from "express-rate-limit";
import argon2 from "argon2";
import { randomUUID, randomBytes, timingSafeEqual } from "node:crypto";
import { z, ZodError } from "zod";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  credentials,
  register,
  profile,
  playlistInput,
  playlistEdit,
  telemetrySchema,
  validateTelemetry,
  uuid,
} from "@resonance/shared";
import { config } from "./config.js";
import {
  collection,
  mongo,
  transaction,
  outbox,
  domainIds,
  db,
  cypher,
} from "./db.js";
import { HttpError, assert } from "./errors.js";
import {
  saveCatalog,
  retire,
  listSongs,
  hydrateSongs,
  refs,
} from "./catalog.js";
import {
  aggregate,
  aggregateNames,
  queries,
  queryGraph,
  plain,
} from "./analytics.js";
import { importRouter } from "./imports.js";
declare module "express-session" {
  interface SessionData {
    userId: string;
    csrf: string;
  }
}
declare global {
  namespace Express {
    interface Request {
      user?: any;
    }
  }
}
export function createApp() {
  const app = express();
  app.disable("x-powered-by");
  app.use(
    helmet({
      contentSecurityPolicy: {
        directives: {
          defaultSrc: ["'self'"],
          scriptSrc: [
            "'self'",
            "https://www.youtube.com",
            "https://s.ytimg.com",
          ],
          frameSrc: [
            "https://www.youtube.com",
            "https://www.youtube-nocookie.com",
          ],
          imgSrc: [
            "'self'",
            "data:",
            "https://i.ytimg.com",
            "https://img.youtube.com",
          ],
          styleSrc: ["'self'", "'unsafe-inline'"],
          connectSrc: ["'self'", "https://www.youtube.com"],
          upgradeInsecureRequests:
            process.env.COOKIE_SECURE === "true" ? [] : null,
        },
      },
      crossOriginEmbedderPolicy: false,
      referrerPolicy: { policy: "strict-origin-when-cross-origin" },
    }),
  );
  app.use(express.json({ limit: "128kb" }));
  app.use(
    session({
      name: "resonance.sid",
      secret: config.secret,
      resave: false,
      saveUninitialized: false,
      store: MongoStore.create({
        clientPromise: Promise.resolve(mongo),
        dbName: config.db,
        collectionName: "auth_sessions",
      }),
      cookie: {
        httpOnly: true,
        sameSite: "lax",
        secure: process.env.COOKIE_SECURE === "true",
        maxAge: 7 * 86400000,
      },
    }),
  );
  const api = express.Router();
  app.use("/api/v1", api);
  api.use(async (req, res, next) => {
    if (req.path === "/auth/me" && !req.session.csrf)
      req.session.csrf = randomBytes(24).toString("hex");
    if (req.session.userId) {
      req.user = await collection("users").findOne({
        userId: req.session.userId,
        status: "active",
      });
      if (!req.user) {
        delete req.session.userId;
      }
    }
    next();
  });
  api.use((req, res, next) => {
    if (!["GET", "HEAD", "OPTIONS"].includes(req.method)) {
      const token = req.headers["x-csrf-token"];
      const expected = req.session.csrf || "";
      if (
        !expected ||
        typeof token !== "string" ||
        token.length !== expected.length ||
        !timingSafeEqual(Buffer.from(token), Buffer.from(expected))
      )
        return next(
          new HttpError(403, "Invalid CSRF token; refresh and retry"),
        );
    }
    next();
  });
  const auth = (req: Request, res: Response, next: NextFunction) =>
    req.user ? next() : next(new HttpError(401, "Please sign in"));
  const admin = (req: Request, res: Response, next: NextFunction) =>
    req.user?.roles.includes("admin")
      ? next()
      : next(new HttpError(403, "Administrator access required"));
  const safeUser = (u: any) =>
    u
      ? Object.fromEntries(
          Object.entries(u).filter(
            ([k]) => !["_id", "passwordHash", "referenceRevision"].includes(k),
          ),
        )
      : null;
  const mutation = async <T>(req: Request, fn: (s: any) => Promise<T>) =>
    transaction(async (s) => {
      const u = await collection("users").findOneAndUpdate(
        { userId: req.user.userId, status: "active" },
        { $inc: { writeRevision: 1 } },
        { session: s },
      );
      assert(u, 401, "Account unavailable");
      return fn(s);
    });
  api.get("/health", async (req, res) => {
    await db.command({ ping: 1 });
    res.json({ ok: true, database: config.db });
  });
  api.get("/auth/me", (req, res) =>
    res.json({ user: safeUser(req.user), csrfToken: req.session.csrf }),
  );
  const limiter = rateLimit({
    windowMs: 15 * 60000,
    limit: 25,
    standardHeaders: "draft-8",
    legacyHeaders: false,
  });
  const establish = async (req: Request, userId: string) => {
    await new Promise<void>((resolve, reject) =>
      req.session.regenerate((e) => (e ? reject(e) : resolve())),
    );
    req.session.userId = userId;
    req.session.csrf = randomBytes(24).toString("hex");
  };
  api.post("/auth/register", limiter, async (req, res) => {
    const input = register.parse(req.body);
    const passwordHash = await argon2.hash(input.password, {
      type: argon2.argon2id,
    });
    const user = {
      userId: randomUUID(),
      emailNormalized: input.email,
      passwordHash,
      displayName: input.displayName,
      roles: ["listener"],
      country: "",
      preferences: { genreIds: [] },
      privacy: { recommendationOptIn: true },
      status: "active",
      version: 1,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    await transaction(async (s) => {
      await collection("users").insertOne(user, { session: s });
      await outbox(s, "users", user.userId, 1, user.userId);
    });
    await establish(req, user.userId);
    res.status(201).json({ user: safeUser(user), csrfToken: req.session.csrf });
  });
  api.post("/auth/login", limiter, async (req, res) => {
    const input = credentials.parse(req.body);
    const u = await collection("users").findOne({
      emailNormalized: input.email,
      status: "active",
    });
    assert(
      u && (await argon2.verify(u.passwordHash, input.password)),
      401,
      "Incorrect email or password",
    );
    await establish(req, u.userId);
    res.json({ user: safeUser(u), csrfToken: req.session.csrf });
  });
  api.post("/auth/logout", (req, res, next) =>
    req.session.destroy((e) => {
      if (e) return next(e);
      res.clearCookie("resonance.sid").json({ ok: true });
    }),
  );
  api.get("/genres", async (req, res) =>
    res.json(
      await collection("genres")
        .find({ status: "active" }, { projection: { _id: 0 } })
        .sort({ name: 1 })
        .toArray(),
    ),
  );
  api.get("/songs", async (req, res) =>
    res.json(
      await listSongs({
        ...req.query,
        includeRetired: req.user?.roles.includes("admin")
          ? req.query.includeRetired
          : undefined,
      }),
    ),
  );
  api.get("/songs/:id", async (req, res) => {
    const s = await collection("songs").findOne({
      songId: uuid.parse(req.params.id),
      fixtureOnly: { $ne: true },
    });
    assert(s, 404, "Song not found");
    res.json((await hydrateSongs([s]))[0]);
  });
  for (const kind of ["artists", "albums"]) {
    api.get("/" + kind, async (req, res) =>
      res.json(
        await collection(kind)
          .find({ status: "active" }, { projection: { _id: 0 } })
          .limit(100)
          .toArray(),
      ),
    );
    api.get("/" + kind + "/:id", async (req, res) => {
      const record = await collection(kind).findOne({
        [domainIds[kind]]: uuid.parse(req.params.id),
      });
      assert(record, 404, "Not found");
      res.json(record);
    });
  }
  api.patch("/profile", auth, async (req, res) => {
    const p = profile.parse(req.body);
    await mutation(req, async (s) => {
      await refs("genres", "genreId", p.genreIds, s);
      await collection("users").updateOne(
        { userId: req.user.userId },
        {
          $set: {
            displayName: p.displayName,
            country: p.country,
            preferences: { genreIds: p.genreIds },
            privacy: { recommendationOptIn: p.recommendationOptIn },
            updatedAt: new Date(),
          },
          $inc: { version: 1 },
        },
        { session: s },
      );
      await outbox(
        s,
        "users",
        req.user.userId,
        req.user.version + 1,
        req.user.userId,
      );
      await collection("app_state").deleteOne(
        { _id: "analytics" as any },
        { session: s },
      );
    });
    res.json({ ok: true });
  });
  api.delete("/profile", auth, async (req, res) => {
    const id = req.user.userId;
    await mutation(req, async (s) => {
      await collection("users").updateOne(
        { userId: id },
        {
          $set: { status: "deleting", deletionRequestedAt: new Date() },
          $inc: { version: 1 },
        },
        { session: s },
      );
      await collection("auth_sessions").deleteMany(
        { session: { $regex: id } },
        { session: s },
      );
      await collection("app_state").deleteOne(
        { _id: "analytics" as any },
        { session: s },
      );
      await outbox(s, "users", id, req.user.version + 1, id);
    });
    req.session.destroy(() => {});
    res.clearCookie("resonance.sid").status(202).json({
      status: "deleting",
      message: "Access revoked. Cleanup will complete in both databases.",
    });
  });
  api.get("/playlists", auth, async (req, res) =>
    res.json(
      await collection("playlists")
        .find({
          $or: [{ ownerUserId: req.user.userId }, { visibility: "public" }],
        })
        .sort({ updatedAt: -1 })
        .limit(100)
        .toArray(),
    ),
  );
  async function playlistFor(req: Request) {
    const p = await collection("playlists").findOne({
      playlistId: uuid.parse(req.params.id),
    });
    assert(p, 404, "Playlist not found");
    assert(
      p.visibility === "public" || p.ownerUserId === req.user?.userId,
      404,
      "Playlist not found",
    );
    return p;
  }
  api.get("/playlists/:id", async (req, res) => {
    const p = await playlistFor(req);
    const songs = await hydrateSongs(
      await collection("songs")
        .find({ songId: { $in: p.tracks.map((x: any) => x.songId) } })
        .toArray(),
    );
    res.json({
      ...p,
      tracks: p.tracks.map((t: any) => ({
        ...t,
        song: songs.find((s) => s.songId === t.songId),
        unavailable:
          songs.find((s) => s.songId === t.songId)?.status !== "active",
      })),
      totalDuration: p.tracks.reduce(
        (n: number, t: any) =>
          n +
          Number(songs.find((s) => s.songId === t.songId)?.durationSec || 0),
        0,
      ),
    });
  });
  api.post("/playlists", auth, async (req, res) => {
    const p = {
      ...playlistInput.parse(req.body),
      playlistId: randomUUID(),
      ownerUserId: req.user.userId,
      tracks: [],
      version: 1,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    await mutation(req, async (s) => {
      await collection("playlists").insertOne(p, { session: s });
      await outbox(s, "playlists", p.playlistId, 1, p.ownerUserId);
    });
    res.status(201).json(p);
  });
  api.put("/playlists/:id", auth, async (req, res) => {
    const p = playlistEdit.parse(req.body),
      id = uuid.parse(req.params.id);
    await mutation(req, async (s) => {
      const old = await collection("playlists").findOne(
        { playlistId: id, ownerUserId: req.user.userId },
        { session: s },
      );
      assert(old, 404, "Playlist not found");
      assert(
        old.version === p.version,
        409,
        "Playlist changed; refresh before editing",
      );
      const existing = new Map(
        old.tracks.map((t: any) => [t.entryId, t.songId]),
      );
      const added = p.tracks.filter(
        (t) => existing.get(t.entryId) !== t.songId,
      );
      await refs(
        "songs",
        "songId",
        [...new Set(added.map((t) => t.songId))],
        s,
      );
      const r = await collection("playlists").updateOne(
        { playlistId: id, ownerUserId: req.user.userId, version: p.version },
        {
          $set: {
            ...p,
            tracks: p.tracks.map((t) => ({
              ...t,
              addedAt: new Date(t.addedAt),
            })),
            version: p.version + 1,
            updatedAt: new Date(),
          },
        },
        { session: s },
      );
      assert(r.modifiedCount, 409, "Playlist changed");
      await outbox(s, "playlists", id, p.version + 1, req.user.userId);
    });
    res.json({ ok: true, version: p.version + 1 });
  });
  api.delete("/playlists/:id", auth, async (req, res) => {
    const id = uuid.parse(req.params.id);
    const { version } = z
      .object({ version: z.number().int().positive() })
      .parse(req.body);
    await mutation(req, async (s) => {
      const current = await collection("playlists").findOne(
        { playlistId: id, ownerUserId: req.user.userId },
        { session: s },
      );
      assert(current, 404, "Playlist not found");
      assert(
        current.version === version,
        409,
        "Playlist changed; refresh before deleting",
      );
      const r = await collection("playlists").deleteOne(
        { playlistId: id, ownerUserId: req.user.userId, version },
        { session: s },
      );
      assert(r.deletedCount, 404, "Playlist not found");
      await outbox(s, "playlists", id, version + 1, req.user.userId);
    });
    res.json({ ok: true });
  });
  api.get("/follows", auth, async (req, res) =>
    res.json(
      await collection("follows").find({ userId: req.user.userId }).toArray(),
    ),
  );
  api.put("/follows/:id", auth, async (req, res) => {
    const id = uuid.parse(req.params.id);
    await mutation(req, async (s) => {
      await refs("artists", "artistId", [id], s);
      await collection("follows").updateOne(
        { userId: req.user.userId, artistId: id },
        {
          $setOnInsert: {
            followId: randomUUID(),
            followedAt: new Date(),
            version: 1,
          },
        },
        { upsert: true, session: s },
      );
      await outbox(s, "users", req.user.userId, 1, req.user.userId);
    });
    res.json({ ok: true });
  });
  api.delete("/follows/:id", auth, async (req, res) => {
    await mutation(req, async (s) => {
      await collection("follows").deleteOne(
        { userId: req.user.userId, artistId: uuid.parse(req.params.id) },
        { session: s },
      );
      await outbox(s, "users", req.user.userId, 1, req.user.userId);
    });
    res.json({ ok: true });
  });
  api.post("/playback", auth, async (req, res) => {
    const p = z
      .object({
        sessionId: uuid,
        songId: uuid,
        context: z.object({
          type: z.enum(["catalog", "playlist"]),
          playlistId: uuid.optional(),
        }),
      })
      .parse(req.body);
    const result = await mutation(req, async (s) => {
      const old = await collection("playback_sessions").findOne(
        { sessionId: p.sessionId },
        { session: s },
      );
      if (old) {
        assert(
          old.userId === req.user.userId && old.songId === p.songId,
          409,
          "Session identity conflict",
        );
        return old;
      }
      await refs("songs", "songId", [p.songId], s);
      const song = await collection("songs").findOne(
        { songId: p.songId, fixtureOnly: { $ne: true } },
        { session: s },
      );
      assert(song, 400, "This song is not playable");
      if (p.context.type === "playlist") {
        assert(p.context.playlistId, 400, "Playlist context required");
        assert(
          await collection("playlists").findOne(
            {
              playlistId: p.context.playlistId,
              "tracks.songId": p.songId,
              $or: [{ visibility: "public" }, { ownerUserId: req.user.userId }],
            },
            { session: s },
          ),
          404,
          "Playlist track unavailable",
        );
      }
      const now = new Date();
      const doc = {
        ...p,
        userId: req.user.userId,
        videoIdSnapshot: song.media.videoId,
        durationSecSnapshot: song.durationSec,
        startedAt: now,
        lastCheckpointAt: now,
        seq: 0,
        playedSeconds: 0,
        coverageRanges: [],
        completionRatio: 0,
        status: "in_progress",
        version: 1,
      };
      await collection("playback_sessions").insertOne(doc, { session: s });
      await outbox(s, "users", req.user.userId, 1, req.user.userId);
      return doc;
    });
    res.status(201).json(result);
  });
  api.put("/playback/:id", auth, async (req, res) => {
    const input = telemetrySchema.parse(req.body);
    const id = uuid.parse(req.params.id);
    const result = await mutation(req, async (s) => {
      const old = await collection("playback_sessions").findOne(
        { sessionId: id, userId: req.user.userId },
        { session: s },
      );
      assert(old, 404, "Playback session not found");
      const fingerprint = JSON.stringify(input);
      if (old.lastPayload === fingerprint) return old;
      assert(old.status === "in_progress", 409, "Session already finalized");
      assert(input.seq > old.seq, 409, "Stale or inconsistent checkpoint");
      let measured;
      try {
        measured = validateTelemetry(old as any, input, new Date());
      } catch (e) {
        throw new HttpError(400, (e as Error).message);
      }
      assert(
        input.endReason !== "skip" || measured.completionRatio < 0.9,
        400,
        "A completed listen cannot be recorded as a skip",
      );
      const next = {
        ...input,
        ...measured,
        status: input.endReason ? "finalized" : "in_progress",
        lastCheckpointAt: new Date(),
        ...(input.endReason ? { endedAt: new Date() } : {}),
        lastPayload: fingerprint,
        version: old.version + 1,
      };
      const r = await collection("playback_sessions").updateOne(
        { sessionId: id, seq: old.seq, status: "in_progress" },
        { $set: next },
        { session: s },
      );
      assert(r.modifiedCount, 409, "Concurrent checkpoint");
      await outbox(s, "users", req.user.userId, next.version, req.user.userId);
      return { ...old, ...next };
    });
    res.json(result);
  });
  api.get("/history", auth, async (req, res) => {
    const { from, to } = dates(req);
    const page = Math.max(1, Number(req.query.page) || 1);
    const match = {
      userId: req.user.userId,
      startedAt: { $gte: from, $lt: to },
    };
    const rows = await collection("playback_sessions")
      .find(match)
      .sort({ startedAt: -1 })
      .skip((page - 1) * 30)
      .limit(30)
      .toArray();
    const songs = await hydrateSongs(
      await collection("songs")
        .find({ songId: { $in: rows.map((x) => x.songId) } })
        .toArray(),
    );
    res.json({
      items: rows.map((x) => ({
        ...x,
        song: songs.find((s) => s.songId === x.songId),
      })),
      total: await collection("playback_sessions").countDocuments(match),
      page,
    });
  });
  api.get("/summary", auth, async (req, res) => {
    const { from, to } = dates(req);
    res.json(await aggregate("A2", req.user.userId, from, to));
  });
  api.get("/recommendations", auth, async (req, res) =>
    res.json(await recommendations(req.user)),
  );
  api.use("/admin", auth, admin);
  for (const kind of ["artists", "albums", "songs"]) {
    api.post("/admin/" + kind, async (req, res) =>
      res.status(201).json(await saveCatalog(kind, req.body)),
    );
    api.put("/admin/" + kind + "/:id", async (req, res) =>
      res.json(await saveCatalog(kind, req.body, uuid.parse(req.params.id))),
    );
    api.delete("/admin/" + kind + "/:id", async (req, res) =>
      res.json(await retire(kind, uuid.parse(req.params.id))),
    );
  }
  api.use("/admin/imports", importRouter());
  api.get("/admin/queries", (req, res) =>
    res.json({
      aggregations: aggregateNames,
      cypher: Object.fromEntries(
        Object.entries(queries).map(([k, v]) => [k, v.name]),
      ),
    }),
  );
  api.get("/admin/analytics/:id", async (req, res) => {
    const id = String(req.params.id);
    assert(aggregateNames[id], 404, "Unknown aggregation");
    const { from, to } = dates(req);
    res.json(await aggregate(id, req.user.userId, from, to));
  });
  api.get("/admin/cypher/:id", async (req, res) => {
    const id = String(req.params.id);
    assert(queries[id], 404, "Unknown query");
    await assertGraphPopulation();
    if (id === "C7") {
      const source = await collection("playlists").findOne({
        playlistId: uuid.parse(req.query.playlistId),
        visibility: "public",
      });
      assert(source, 404, "Public playlist not found");
      assert(
        await collection("users").findOne({
          userId: source.ownerUserId,
          status: "active",
          "privacy.recommendationOptIn": true,
        }),
        404,
        "Playlist owner is not in the graph",
      );
    }
    const r = await queryGraph(id, {
      userId: req.user.userId,
      genreIds: req.user.preferences.genreIds,
      playlistId: String(req.query.playlistId || ""),
      artistId: String(req.query.artistId || ""),
      otherArtistId: String(req.query.otherArtistId || ""),
    });
    res.json(await sanitizeGraphResult(r));
  });
  api.get("/admin/graph", async (req, res) => {
    const root = req.query.root ? uuid.parse(req.query.root) : "";
    const eligible = (
      await collection("users")
        .find({ status: "active", "privacy.recommendationOptIn": true })
        .toArray()
    ).map((x) => x.userId);
    const publicPlaylists = (
      await collection("playlists")
        .find({ visibility: "public", ownerUserId: { $in: eligible } })
        .toArray()
    ).map((x) => x.playlistId);
    const result = await cypher(
      "MATCH (a)-[r]->(b) WHERE ($root='' OR $root IN [a.userId,a.songId,a.artistId,a.albumId,a.genreId,a.playlistId,b.userId,b.songId,b.artistId,b.albumId,b.genreId,b.playlistId]) AND (NOT a:User OR a.userId IN $users) AND (NOT b:User OR b.userId IN $users) AND (NOT a:Playlist OR a.playlistId IN $playlists) AND (NOT b:Playlist OR b.playlistId IN $playlists) WITH type(r) AS kind,collect({a:a,r:r,b:b})[0..50] AS sample UNWIND sample AS row RETURN row.a AS a,row.r AS r,row.b AS b LIMIT 350",
      { users: eligible, playlists: publicPlaylists, root },
    );
    const nodes = new Map();
    const edges = [];
    for (const row of result as any[]) {
      for (const n of [row.a, row.b]) {
        const p = plain(n.properties);
        const id =
          p.userId ||
          p.songId ||
          p.artistId ||
          p.albumId ||
          p.genreId ||
          p.playlistId;
        nodes.set(n.identity.toString(), {
          data: {
            id,
            label:
              p.name ||
              p.title ||
              (p.userId ? "Listener " + p.userId.slice(0, 6) : id),
            type: n.labels[0],
          },
        });
      }
      edges.push({
        data: {
          id: row.r.identity.toString(),
          source: nodes.get(row.a.identity.toString()).data.id,
          target: nodes.get(row.b.identity.toString()).data.id,
          label: row.r.type,
        },
      });
    }
    res.json({ nodes: [...nodes.values()], edges });
  });
  api.get("/admin/status", async (req, res) => {
    const [counts, failed, oldest, analytics, state] = await Promise.all([
      collection("sync_outbox")
        .aggregate([{ $group: { _id: "$status", count: { $sum: 1 } } }])
        .toArray(),
      collection("sync_outbox").find({ status: "failed" }).limit(30).toArray(),
      collection("sync_outbox")
        .find({ status: "pending" })
        .sort({ createdAt: 1 })
        .limit(1)
        .toArray(),
      collection("app_state").findOne({ _id: "analytics" as any }),
      collection("app_state").findOne({ _id: "worker" as any }),
    ]);
    const eligibleIds = (
      await collection("users")
        .find({ status: "active", "privacy.recommendationOptIn": true })
        .toArray()
    )
      .map((u) => u.userId)
      .sort();
    res.json({
      counts,
      failed,
      oldestPendingAgeSeconds: oldest[0]
        ? (Date.now() - oldest[0].createdAt.getTime()) / 1000
        : 0,
      analytics:
        analytics &&
        JSON.stringify(analytics.eligibleUserIds) ===
          JSON.stringify(eligibleIds)
          ? analytics
          : null,
      worker: state,
      youtubeConfigured: !!config.youtubeKey,
    });
  });
  api.post("/admin/retry", async (req, res) => {
    await collection("sync_outbox").updateMany(
      { status: "failed" },
      {
        $set: {
          status: "pending",
          attempts: 0,
          nextAttemptAt: new Date(),
          lastError: null,
        },
      },
    );
    res.json({ ok: true });
  });
  api.post("/admin/reconcile", async (req, res) => {
    await collection("app_state").updateOne(
      { _id: "commands" as any },
      { $set: { rebuild: true } },
      { upsert: true },
    );
    res.status(202).json({ queued: true });
  });
  api.post("/admin/analytics-refresh", async (req, res) => {
    await collection("app_state").updateOne(
      { _id: "commands" as any },
      { $set: { analytics: true } },
      { upsert: true },
    );
    res.status(202).json({ queued: true });
  });
  api.get("/admin/quality", async (req, res) => res.json(await dataQuality()));
  api.get("/openapi.json", async (req, res) =>
    res.sendFile(
      fileURLToPath(new URL("../../../docs/openapi.json", import.meta.url)),
    ),
  );
  api.use((req, res) => res.status(404).json({ error: "Endpoint not found" }));
  if (config.production) {
    const dir = fileURLToPath(new URL("../../web/dist/", import.meta.url));
    app.use(express.static(dir));
    app.get("/{*path}", (req, res) =>
      res.sendFile(path.join(dir, "index.html")),
    );
  }
  app.use((err: any, req: Request, res: Response, next: NextFunction) => {
    if (err instanceof ZodError)
      return res.status(400).json({
        error: err.issues
          .map((x) => `${x.path.join(".")}: ${x.message}`)
          .join("; "),
      });
    if (err.code === 11000)
      return res.status(409).json({
        error: "That email, video, or external identifier already exists",
      });
    const code =
      err instanceof HttpError
        ? err.status
        : err.name?.includes("Mongo")
          ? 503
          : 500;
    if (code === 500) console.error(err);
    res.status(code).json({
      error:
        code === 500
          ? "Operation failed. Retry or inspect server logs."
          : code === 503 && !(err instanceof HttpError)
            ? "Database unavailable. Please retry."
            : err.message,
    });
  });
  return app;
}
function dates(req: Request) {
  const from = req.query.from ? new Date(String(req.query.from)) : new Date(0),
    to = req.query.to ? new Date(String(req.query.to)) : new Date();
  assert(
    !isNaN(+from) && !isNaN(+to) && from < to,
    400,
    "Invalid date interval",
  );
  return { from, to };
}
async function sanitizeGraphResult(r: any) {
  const eligible = new Set(
    (
      await collection("users")
        .find({ status: "active", "privacy.recommendationOptIn": true })
        .toArray()
    ).map((x) => x.userId),
  );
  const playlists = new Set(
    (
      await collection("playlists")
        .find({ visibility: "public", ownerUserId: { $in: [...eligible] } })
        .toArray()
    ).map((x) => x.playlistId),
  );
  return {
    ...r,
    rows: r.rows.filter(
      (x: any) =>
        (!x.userId || eligible.has(x.userId)) &&
        (!x.playlistId || playlists.has(x.playlistId)),
    ),
  };
}
async function assertGraphPopulation() {
  const projection = await collection("app_state").findOne({
    _id: "projection" as any,
  });
  const eligible = (
    await collection("users")
      .find(
        { status: "active", "privacy.recommendationOptIn": true },
        { projection: { userId: 1 } },
      )
      .toArray()
  )
    .map((u) => u.userId)
    .sort();
  assert(
    JSON.stringify(projection?.eligibleUserIds) === JSON.stringify(eligible),
    503,
    "Graph refresh pending after a membership or privacy change",
  );
}
export async function recommendations(user: any) {
  const listened = await collection("playback_sessions")
    .aggregate([
      { $match: { userId: user.userId, status: "finalized" } },
      {
        $match: {
          $expr: {
            $gte: [
              "$playedSeconds",
              { $min: [30, { $multiply: ["$durationSecSnapshot", 0.5] }] },
            ],
          },
        },
      },
      { $group: { _id: "$songId" } },
    ])
    .toArray();
  const heard = new Set(listened.map((x) => x._id));
  let candidates: { songId: string; reason: string }[] = [];
  let source = "popularity";
  if (user.privacy.recommendationOptIn) {
    try {
      await assertGraphPopulation();
      const followed = await queryGraph("C3", { userId: user.userId });
      const neighbors = await queryGraph("C4", { userId: user.userId });
      const eligible = await collection("users")
        .find({
          userId: { $in: neighbors.rows.map((x: any) => x.userId) },
          status: "active",
          "privacy.recommendationOptIn": true,
        })
        .toArray();
      const eligibleSet = new Set(eligible.map((x) => x.userId));
      const collaborative = plain(
        await cypher(queries.C5.query, {
          userId: user.userId,
          neighbors: neighbors.rows.filter((x: any) =>
            eligibleSet.has(x.userId),
          ),
        }),
      );
      const genres = await queryGraph("C10", {
        userId: user.userId,
        genreIds: user.preferences.genreIds,
      });
      const currentFollows = await collection("follows")
        .find({ userId: user.userId })
        .toArray();
      const followIds = new Set(currentFollows.map((x) => x.artistId));
      const followedSongs = await collection("songs")
        .find({
          songId: { $in: followed.rows.map((x: any) => x.songId) },
          "artistCredits.artistId": { $in: [...followIds] },
        })
        .toArray();
      candidates = [
        ...followedSongs.map((x: any) => ({
          songId: x.songId,
          reason: "From an artist you follow",
        })),
        ...collaborative.map((x: any) => ({
          songId: x.songId,
          reason: "Listeners with similar taste also enjoy this",
        })),
        ...genres.rows.map((x: any) => ({
          songId: x.songId,
          reason: "In your preferred genres",
        })),
      ];
      source = "graph";
    } catch {
      source = "popularity-fallback";
    }
  }
  const popularity = await aggregate("A1", user.userId);
  candidates.push(
    ...popularity.rows.map((x: any) => ({
      songId: x._id,
      reason: "Popular with listeners",
    })),
  );
  const recent = await collection("songs")
    .find({ status: "active", fixtureOnly: { $ne: true } })
    .sort({ createdAt: -1, songId: 1 })
    .limit(50)
    .toArray();
  candidates.push(
    ...recent.map((x) => ({
      songId: x.songId,
      reason: "Discover the catalog",
    })),
  );
  // Keep the first occurrence's rank and reason. A later popularity/catalog
  // duplicate must not move a personalized candidate down the list.
  const seen = new Set<string>();
  const unique = candidates.filter((candidate) => {
    if (
      seen.has(candidate.songId) ||
      (user.privacy.recommendationOptIn && heard.has(candidate.songId))
    )
      return false;
    seen.add(candidate.songId);
    return true;
  });
  const rows = await hydrateSongs(
    await collection("songs")
      .find({
        songId: { $in: unique.map((x) => x.songId) },
        status: "active",
        fixtureOnly: { $ne: true },
      })
      .toArray(),
  );
  return {
    source,
    items: unique
      .map((x) => ({
        ...rows.find((r) => r.songId === x.songId),
        reason: x.reason,
      }))
      .filter((x) => x.songId)
      .slice(0, 24),
  };
}
export async function dataQuality() {
  const checks = [];
  for (const [source, local, target, foreign, unwind] of [
    ["songs", "albumId", "albums", "albumId", null],
    ["songs", "artistCredits.artistId", "artists", "artistId", "artistCredits"],
    ["songs", "genreIds", "genres", "genreId", "genreIds"],
    ["albums", "artistIds", "artists", "artistId", "artistIds"],
    ["playlists", "tracks.songId", "songs", "songId", "tracks"],
    ["playlists", "ownerUserId", "users", "userId", null],
    ["playback_sessions", "userId", "users", "userId", null],
    ["playback_sessions", "songId", "songs", "songId", null],
    ["follows", "artistId", "artists", "artistId", null],
    ["follows", "userId", "users", "userId", null],
  ] as const) {
    const pipeline: any[] = [
      ...(unwind ? [{ $unwind: "$" + unwind }] : []),
      {
        $lookup: {
          from: target,
          localField: local,
          foreignField: foreign,
          as: "target",
        },
      },
      {
        $match: {
          $or: [
            { "target.0": { $exists: false } },
            ...(target === "users" ? [{ "target.status": "deleted" }] : []),
          ],
        },
      },
      { $count: "count" },
    ];
    const bad = await collection(source).aggregate(pipeline).toArray();
    checks.push({
      check: `${source}.${local} → ${target}`,
      violations: bad[0]?.count || 0,
    });
  }
  const playlists = await collection("playlists").find({}).toArray();
  checks.push({
    check: "Playlist entry identity, order and size",
    violations: playlists.filter(
      (p) =>
        p.tracks.length > 500 ||
        new Set(p.tracks.map((t: any) => t.entryId)).size !== p.tracks.length ||
        p.tracks.some((t: any, i: number) => t.position !== i + 1),
    ).length,
  });
  return { calculatedAt: new Date(), checks };
}
