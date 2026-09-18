import { MongoClient, type ClientSession, type Document } from "mongodb";
import neo4j from "neo4j-driver";
import { randomUUID } from "node:crypto";
import { config } from "./config.js";
export const mongo = new MongoClient(config.mongoUrl, {
  serverSelectionTimeoutMS: 5000,
});
export const db = mongo.db(config.db);
export const collection = (name: string) => db.collection<Document>(name);
export const graph = neo4j.driver(
  config.neoUri,
  neo4j.auth.basic(config.neoUser, config.neoPassword),
  {
    connectionTimeout: 2000,
    connectionAcquisitionTimeout: 2000,
    maxTransactionRetryTime: 2000,
  },
);
export async function cypher(
  query: string,
  params: Record<string, unknown> = {},
) {
  const s = graph.session();
  try {
    const r = await s.run(query, params, { timeout: 4000 });
    return r.records.map((x) => x.toObject());
  } finally {
    await s.close();
  }
}
export async function transaction<T>(
  fn: (session: ClientSession) => Promise<T>,
) {
  const s = mongo.startSession();
  try {
    return (await s.withTransaction(() => fn(s)))!;
  } finally {
    await s.endSession();
  }
}
export async function outbox(
  session: ClientSession,
  aggregateType: string,
  aggregateId: string,
  sourceVersion = 1,
  affectedUserId?: string,
) {
  await collection("sync_outbox").insertOne(
    {
      taskId: randomUUID(),
      aggregateType,
      aggregateId,
      affectedUserId,
      sourceVersion,
      status: "pending",
      attempts: 0,
      nextAttemptAt: new Date(),
      createdAt: new Date(),
    },
    { session },
  );
}
export const domainIds: Record<string, string> = {
  users: "userId",
  artists: "artistId",
  albums: "albumId",
  songs: "songId",
  playlists: "playlistId",
  playback_sessions: "sessionId",
  follows: "followId",
  genres: "genreId",
};
export async function initDb() {
  const existing = new Set(
    (await db.listCollections().toArray()).map((x) => x.name),
  );
  for (const [name, id] of Object.entries(domainIds)) {
    const required = [id, "version"];
    const properties: Record<string, unknown> = {
      [id]: { bsonType: "string", pattern: "^[0-9a-f-]{36}$" },
      version: { bsonType: ["int", "long", "double"], minimum: 1 },
    };
    if (name === "songs") {
      required.push(
        "title",
        "albumId",
        "artistCredits",
        "genreIds",
        "durationSec",
      );
      Object.assign(properties, {
        durationSec: { bsonType: ["int", "long", "double"], minimum: 0.001 },
        artistCredits: { bsonType: "array", minItems: 1 },
        genreIds: { bsonType: "array", minItems: 1 },
      });
    }
    if (name === "playlists") {
      required.push("ownerUserId", "tracks", "visibility");
      Object.assign(properties, {
        tracks: { bsonType: "array", maxItems: 500 },
        visibility: { enum: ["public", "private"] },
      });
    }
    if (name === "users") {
      required.push("status");
      properties.status = { enum: ["active", "deleting", "deleted"] };
    }
    const validator = {
      $jsonSchema: { bsonType: "object", required, properties },
    };
    if (!existing.has(name)) await db.createCollection(name, { validator });
    else await db.command({ collMod: name, validator });
    await collection(name).createIndex({ [id]: 1 }, { unique: true });
  }
  const indexes: [string, Record<string, 1 | -1>, Record<string, unknown>?][] =
    [
      [
        "users",
        { emailNormalized: 1 },
        {
          unique: true,
          partialFilterExpression: { emailNormalized: { $type: "string" } },
        },
      ],
      ["artists", { searchName: 1, status: 1 }],
      ["albums", { searchTitle: 1, status: 1 }],
      ["albums", { artistIds: 1, releaseDate: 1 }],
      ["songs", { searchTitle: 1, status: 1 }],
      ["songs", { "artistCredits.artistId": 1, status: 1 }],
      ["songs", { albumId: 1, status: 1 }],
      ["songs", { genreIds: 1, status: 1 }],
      [
        "songs",
        { "media.videoId": 1 },
        {
          unique: true,
          partialFilterExpression: { "media.provider": "youtube" },
        },
      ],
      ["playlists", { ownerUserId: 1, updatedAt: -1 }],
      ["playback_sessions", { userId: 1, startedAt: -1 }],
      ["playback_sessions", { songId: 1, startedAt: -1 }],
      ["playback_sessions", { startedAt: 1 }],
      ["playback_sessions", { "context.playlistId": 1, startedAt: 1 }],
      ["follows", { userId: 1, artistId: 1 }, { unique: true }],
      ["genres", { slug: 1 }, { unique: true }],
      ["sync_outbox", { taskId: 1 }, { unique: true }],
      ["sync_outbox", { status: 1, nextAttemptAt: 1 }],
      ["sync_outbox", { affectedUserId: 1 }],
      ["import_jobs", { jobId: 1 }, { unique: true }],
      ["import_jobs", { status: 1, createdAt: 1 }],
    ];
  for (const [name, keys, opts] of indexes)
    await collection(name).createIndex(keys, opts || {});
  for (const name of ["artists", "albums"])
    await collection(name).createIndex(
      { musicbrainzId: 1 },
      {
        unique: true,
        partialFilterExpression: { musicbrainzId: { $type: "string" } },
      },
    );
}
export async function initGraph() {
  for (const [label, id] of Object.entries({
    User: "userId",
    Artist: "artistId",
    Album: "albumId",
    Song: "songId",
    Genre: "genreId",
    Playlist: "playlistId",
  }))
    await cypher(
      `CREATE CONSTRAINT ${label.toLowerCase()}_identity IF NOT EXISTS FOR (n:${label}) REQUIRE n.${id} IS UNIQUE`,
    );
}
export async function closeDb() {
  await Promise.all([mongo.close(), graph.close()]);
}
