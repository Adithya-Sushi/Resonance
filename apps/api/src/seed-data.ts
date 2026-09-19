import { v5 } from "uuid";
import { normalize, coverage } from "@resonance/shared";
const NS = "f0ac4c84-e3b4-4c4e-a9cb-d72996fd1f1c";
export const seedId = (x: string) => v5(x, NS);
import { demoCatalog, type DemoTrack } from "./demo-catalog.js";
export const demoSongId = (
  i: number,
  catalog: readonly DemoTrack[] = demoCatalog,
) =>
  seedId(
    catalog[i].videoId === "60ItHLz5WEA"
      ? "real-song:10"
      : "demo-song:" + catalog[i].videoId,
  );
const demoArtistId = (name: string) =>
  seedId(name === "Alan Walker" ? "real-artist:10" : "demo-artist:" + name);
const demoAlbumId = (i: number, catalog: readonly DemoTrack[]) =>
  seedId(
    catalog[i].videoId === "60ItHLz5WEA"
      ? "real-album:10"
      : "demo-album:" + catalog[i].videoId,
  );
export function seedData(
  fixture = false,
  passwordHash = "",
  now = new Date(),
  catalog: readonly DemoTrack[] = demoCatalog,
) {
  const base = { status: "active", version: 1, createdAt: now, updatedAt: now };
  const names = [
    "Pop",
    "Rock",
    "Electronic",
    "Indie",
    "Soul",
    "Acoustic",
    "Latin",
    "Alternative",
  ];
  if (!fixture)
    names.push(
      ...new Set(
        catalog
          .flatMap((r) => [...r.genres])
          .filter((name) => !names.includes(name)),
      ),
    );
  const genres = names.map((name) => ({
    ...base,
    genreId: seedId("genre:" + name),
    name,
    slug: name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, ""),
  }));
  const users = Array.from({ length: 20 }, (_, i) => ({
    ...base,
    userId: seedId("user:" + i),
    emailNormalized:
      i === 0
        ? "admin@resonance.local"
        : i === 1
          ? "listener@resonance.local"
          : `listener${i}@resonance.local`,
    passwordHash,
    displayName:
      i === 0 ? "Alex Morgan" : i === 1 ? "Sam Rivers" : `Demo listener ${i}`,
    roles: i === 0 ? ["admin", "listener"] : ["listener"],
    country: "India",
    preferences: { genreIds: [genres[i % 8].genreId] },
    privacy: { recommendationOptIn: true },
  }));
  const artists = fixture
    ? Array.from({ length: 20 }, (_, i) => ({
        ...base,
        artistId: seedId("artist:" + i),
        name: `Fixture Artist ${i + 1}`,
        searchName: `fixture artist ${i + 1}`,
        genreIds: [genres[i % 8].genreId],
        bio: "Synthetic database test artist",
        country: "India",
      }))
    : [...new Set(catalog.flatMap((r) => r.artists.map((a) => a.name)))].map(
        (name) => ({
          ...base,
          artistId: demoArtistId(name),
          name,
          searchName: normalize(name),
          genreIds: [
            ...new Set(
              catalog
                .filter((r) => r.artists.some((a) => a.name === name))
                .flatMap((r) => r.genres.map((g) => seedId("genre:" + g))),
            ),
          ],
          bio: "Explore their music on Resonance.",
          country: "",
        }),
      );
  const albums = fixture
    ? Array.from({ length: 30 }, (_, i) => ({
        ...base,
        albumId: seedId("album:" + i),
        title: `Fixture Album ${i + 1}`,
        searchTitle: `fixture album ${i + 1}`,
        artistIds: [artists[i % 20].artistId],
        releaseDate: new Date(`${2018 + (i % 6)}-01-01`),
        type: "album",
      }))
    : catalog.map((r, i) => ({
        ...base,
        albumId: demoAlbumId(i, catalog),
        title: r.album,
        searchTitle: normalize(r.album),
        artistIds: r.artists
          .filter((a) => a.role === "primary")
          .map((a) => demoArtistId(a.name)),
        releaseDate: new Date(r.releaseDate),
        type: r.videoId === "60ItHLz5WEA" ? "album" : "single",
        provenance: { source: r.releaseSource, retrievedAt: r.checkedAt },
      }));
  const songs = fixture
    ? Array.from({ length: 120 }, (_, i) => ({
        ...base,
        songId: seedId("song:" + i),
        title: `Fixture Song ${String(i + 1).padStart(3, "0")}`,
        searchTitle: `fixture song ${String(i + 1).padStart(3, "0")}`,
        artistCredits: [
          { artistId: artists[i % 20].artistId, role: "primary" },
          ...(i < 20
            ? [{ artistId: artists[(i + 1) % 20].artistId, role: "featured" }]
            : []),
        ],
        albumId: albums[i % 30].albumId,
        genreIds: [genres[i % 8].genreId, genres[(i + 1) % 8].genreId],
        durationSec: 180 + (i % 120),
        language: ["English", "Hindi", "Spanish", "Korean"][i % 4],
        trackNumber: (i % 10) + 1,
        discNumber: 1,
        media: { provider: "fixture" },
        fixtureOnly: true,
      }))
    : catalog.map((r, i) => ({
        ...base,
        songId: demoSongId(i, catalog),
        title: r.title,
        searchTitle: normalize(r.title),
        artistCredits: r.artists.map((a) => ({
          artistId: demoArtistId(a.name),
          role: a.role,
        })),
        albumId: demoAlbumId(i, catalog),
        genreIds: r.genres.map((g) => seedId("genre:" + g)),
        durationSec: r.durationSec,
        language: r.language,
        trackNumber: r.videoId === "60ItHLz5WEA" ? 15 : 1,
        discNumber: 1,
        media: { provider: "youtube", videoId: r.videoId },
        provenance: {
          catalog: "curated-demo",
          source: r.source,
          retrievedAt: r.checkedAt,
          duration: "YouTube IFrame player duration, rounded to seconds",
          embedPlaybackCheckedAt: r.checkedAt,
        },
      }));
  const playlists = Array.from({ length: fixture ? 30 : 8 }, (_, i) => ({
    ...base,
    playlistId: seedId((fixture ? "" : "real-") + "playlist:" + i),
    ownerUserId: users[i % 20].userId,
    name: fixture
      ? `Fixture playlist ${i + 1}`
      : [
          "The daily rotation",
          "After hours",
          "Golden hour",
          "A little nostalgia",
          "Volume up",
          "Slow mornings",
          "On repeat",
          "Around the world",
        ][i],
    description: fixture
      ? "Synthetic fixture"
      : "A collection for wherever the day takes you.",
    visibility: "public",
    tracks: Array.from(
      { length: fixture ? (i === 0 ? 0 : i === 29 ? 20 : 10) : 6 },
      (_, j) => ({
        entryId: seedId(`entry:${fixture}:${i}:${j}`),
        songId: songs[(i * 7 + j) % songs.length].songId,
        position: j + 1,
        addedAt: now,
      }),
    ),
  }));
  const follows = Array.from({ length: 80 }, (_, i) => ({
    ...base,
    followId: seedId(`follow:${fixture}:${i}`),
    userId: users[Math.floor(i / 4)].userId,
    artistId: artists[(Math.floor(i / 4) + (i % 4)) % artists.length].artistId,
    followedAt: now,
  }));
  const playback_sessions = Array.from({ length: 500 }, (_, i) => {
    const pair = i % 350,
      u = pair % 19,
      s = songs[(Math.floor(pair / 19) + u * 6) % songs.length];
    const skip = i % 11 === 0;
    const playedSeconds = skip ? 12 : s.durationSec * (i % 3 === 0 ? 0.65 : 1);
    const startedAt = new Date(+now - (i % 45) * 86400000 - (i + 1) * 600000);
    const contextPlaylist = playlists.find((p) =>
      p.tracks.some((t: any) => t.songId === s.songId),
    );
    return {
      sessionId: seedId(`session:${fixture}:${i}`),
      userId: users[u].userId,
      songId: s.songId,
      durationSecSnapshot: s.durationSec,
      videoIdSnapshot: "videoId" in s.media ? s.media.videoId : null,
      startedAt,
      lastCheckpointAt: new Date(+startedAt + playedSeconds * 1000),
      endedAt: new Date(+startedAt + playedSeconds * 1000),
      seq: Math.ceil(playedSeconds / 10),
      playedSeconds,
      coverageRanges: [[0, playedSeconds]],
      completionRatio: coverage([[0, playedSeconds]], s.durationSec),
      endReason: skip ? "skip" : i % 3 === 0 ? "stopped" : "ended",
      context:
        i % 2 === 0 && contextPlaylist
          ? {
              type: "playlist",
              playlistId: contextPlaylist.playlistId,
            }
          : { type: "catalog" },
      status: "finalized",
      version: 1,
      synthetic: true,
    };
  });
  return {
    users,
    artists,
    albums,
    songs,
    playlists,
    playback_sessions,
    follows,
    genres,
  };
}
