import { randomUUID } from "node:crypto";
import type { ClientSession, Document } from "mongodb";
import { collection, transaction, outbox, domainIds } from "./db.js";
import { assert } from "./errors.js";
import {
  artistInput,
  albumInput,
  songInput,
  normalize,
  escapeRegex,
} from "@resonance/shared";
export async function refs(
  name: string,
  id: string,
  ids: string[],
  session?: ClientSession,
) {
  assert(new Set(ids).size === ids.length, 400, "Duplicate references");
  const rows = await collection(name)
    .find({ [id]: { $in: ids }, status: "active" }, { session })
    .toArray();
  assert(rows.length === ids.length, 400, `Missing or retired ${name}`);
  // Touch referenced documents to conflict with concurrent retirement transactions.
  if (session && ids.length)
    await collection(name).updateMany(
      { [id]: { $in: ids } },
      { $inc: { referenceRevision: 1 } },
      { session },
    );
}
export async function saveCatalog(kind: string, body: unknown, id?: string) {
  const schemas: Record<string, any> = {
    artists: artistInput,
    albums: albumInput,
    songs: songInput,
  };
  assert(schemas[kind], 404, "Unknown catalog type");
  const value = schemas[kind].parse(body);
  const key = domainIds[kind];
  return transaction(async (s) => {
    if (kind === "artists") await refs("genres", "genreId", value.genreIds, s);
    if (kind === "albums")
      await refs("artists", "artistId", value.artistIds, s);
    if (kind === "songs") {
      await refs(
        "artists",
        "artistId",
        value.artistCredits.map((x: any) => x.artistId),
        s,
      );
      await refs("genres", "genreId", value.genreIds, s);
      await refs("albums", "albumId", [value.albumId], s);
    }
    const old = id
      ? await collection(kind).findOne({ [key]: id }, { session: s })
      : null;
    assert(!id || old, 404, "Catalog record not found");
    const doc = {
      ...value,
      ...(kind === "albums"
        ? { releaseDate: new Date(value.releaseDate) }
        : {}),
      [key]: id || randomUUID(),
      ...(kind === "artists"
        ? { searchName: normalize(value.name) }
        : { searchTitle: normalize(value.title) }),
      status: old?.status || "active",
      version: (old?.version || 0) + 1,
      createdAt: old?.createdAt || new Date(),
      updatedAt: new Date(),
    };
    await collection(kind).replaceOne({ [key]: doc[key] }, doc, {
      upsert: true,
      session: s,
    });
    await outbox(s, kind, doc[key], doc.version);
    return doc;
  });
}
export async function retire(kind: string, id: string) {
  assert(
    ["artists", "albums", "songs"].includes(kind),
    404,
    "Unknown catalog type",
  );
  return transaction(async (s) => {
    const key = domainIds[kind];
    assert(
      await collection(kind).findOne({ [key]: id }, { session: s }),
      404,
      "Not found",
    );
    if (kind === "artists")
      assert(
        !(await collection("songs").findOne(
          { "artistCredits.artistId": id, status: "active" },
          { session: s },
        )) &&
          !(await collection("albums").findOne(
            { artistIds: id, status: "active" },
            { session: s },
          )),
        409,
        "Retire dependent songs and albums first",
      );
    if (kind === "albums")
      assert(
        !(await collection("songs").findOne(
          { albumId: id, status: "active" },
          { session: s },
        )),
        409,
        "Retire dependent songs first",
      );
    await collection(kind).updateOne(
      { [key]: id },
      {
        $set: { status: "retired", updatedAt: new Date() },
        $inc: { version: 1 },
      },
      { session: s },
    );
    await outbox(s, kind, id);
    return { ok: true };
  });
}
export async function hydrateSongs(rows: Document[]): Promise<any[]> {
  const [artists, albums, genres] = await Promise.all([
    collection("artists")
      .find({
        artistId: {
          $in: rows.flatMap((x) => x.artistCredits.map((a: any) => a.artistId)),
        },
      })
      .toArray(),
    collection("albums")
      .find({ albumId: { $in: rows.map((x) => x.albumId) } })
      .toArray(),
    collection("genres").find({}).toArray(),
  ]);
  return rows.map(({ _id, ...s }) => ({
    ...s,
    artists: s.artistCredits
      .map((a: any) => artists.find((x) => x.artistId === a.artistId))
      .filter(Boolean)
      .map((a: any) => ({ artistId: a.artistId, name: a.name })),
    album: albums.find((a) => a.albumId === s.albumId),
    genres: genres.filter((g) => s.genreIds.includes(g.genreId)),
  }));
}
export async function listSongs(query: Record<string, any>) {
  const page = Math.max(1, Math.min(10000, Number(query.page) || 1)),
    limit = Math.max(1, Math.min(50, Number(query.limit) || 24));
  const match: Document = {
    status:
      query.includeRetired === "true"
        ? { $in: ["active", "retired"] }
        : "active",
    fixtureOnly: { $ne: true },
  };
  if (query.q) {
    const pattern = new RegExp(
      "^" + escapeRegex(normalize(String(query.q).slice(0, 200))),
    );
    const [a, b] = await Promise.all([
      collection("artists").find({ searchName: pattern }).limit(100).toArray(),
      collection("albums").find({ searchTitle: pattern }).limit(100).toArray(),
    ]);
    match.$or = [
      { searchTitle: pattern },
      { "artistCredits.artistId": { $in: a.map((x) => x.artistId) } },
      { albumId: { $in: b.map((x) => x.albumId) } },
    ];
  }
  if (query.genre) match.genreIds = query.genre;
  if (query.language) match.language = query.language;
  if (query.artistId) match["artistCredits.artistId"] = query.artistId;
  if (query.albumId) match.albumId = query.albumId;
  if (query.year) {
    const year = Number(query.year);
    assert(year >= 1900 && year <= 2100, 400, "Invalid year");
    const albums = await collection("albums")
      .find({
        releaseDate: {
          $gte: new Date(`${year}-01-01`),
          $lt: new Date(`${year + 1}-01-01`),
        },
      })
      .toArray();
    match.albumId = { $in: albums.map((x) => x.albumId) };
  }
  const [rows, total] = await Promise.all([
    collection("songs")
      .find(match)
      .sort({ searchTitle: 1, songId: 1 })
      .skip((page - 1) * limit)
      .limit(limit)
      .toArray(),
    collection("songs").countDocuments(match),
  ]);
  return { items: await hydrateSongs(rows), total, page, limit };
}
