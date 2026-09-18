import { v5 } from "uuid";
import { normalize, coverage } from "@resonance/shared";
const NS = "f0ac4c84-e3b4-4c4e-a9cb-d72996fd1f1c";
export const seedId = (x: string) => v5(x, NS);
export const music = [
  [
    "Never Gonna Give You Up",
    "Rick Astley",
    "Whenever You Need Somebody",
    "1987-11-16",
    "dQw4w9WgXcQ",
    213,
    "English",
    "Pop",
  ],
  [
    "Shape of You",
    "Ed Sheeran",
    "÷",
    "2017-03-03",
    "JGwWNGJdvx8",
    264,
    "English",
    "Pop",
  ],
  [
    "Despacito",
    "Luis Fonsi",
    "Vida",
    "2019-02-01",
    "kJQP7kiw5Fk",
    282,
    "Spanish",
    "Latin",
  ],
  [
    "Bohemian Rhapsody",
    "Queen",
    "A Night at the Opera",
    "1975-11-21",
    "fJ9rUzIMcZQ",
    360,
    "English",
    "Rock",
  ],
  [
    "Uptown Funk",
    "Mark Ronson",
    "Uptown Special",
    "2015-01-13",
    "OPf0YbXqDm0",
    271,
    "English",
    "Soul",
  ],
  [
    "Sugar",
    "Maroon 5",
    "V",
    "2014-08-29",
    "09R8_2nJtjg",
    302,
    "English",
    "Pop",
  ],
  [
    "Counting Stars",
    "OneRepublic",
    "Native",
    "2013-03-22",
    "hT_nvWreIhg",
    283,
    "English",
    "Indie",
  ],
  ["Hello", "Adele", "25", "2015-11-20", "YQHsXMglC9A", 367, "English", "Soul"],
  [
    "Roar",
    "Katy Perry",
    "Prism",
    "2013-10-18",
    "CevxZvSJLk8",
    270,
    "English",
    "Pop",
  ],
  [
    "Let Her Go",
    "Passenger",
    "All the Little Lights",
    "2012-02-24",
    "RBumgq5yVrA",
    255,
    "English",
    "Acoustic",
  ],
  [
    "Faded",
    "Alan Walker",
    "Different World",
    "2018-12-14",
    "60ItHLz5WEA",
    213,
    "English",
    "Electronic",
  ],
  [
    "Waka Waka (This Time for Africa)",
    "Shakira",
    "Sale el Sol",
    "2010-10-19",
    "pRpeEdMmmQ0",
    211,
    "English",
    "Latin",
  ],
  [
    "Numb",
    "Linkin Park",
    "Meteora",
    "2003-03-25",
    "kXYiU_JCYtU",
    187,
    "English",
    "Rock",
  ],
  [
    "Gangnam Style",
    "PSY",
    "PSY 6 (Six Rules), Part 1",
    "2012-07-15",
    "9bZkp7q19f0",
    253,
    "Korean",
    "Pop",
  ],
  [
    "Paradise",
    "Coldplay",
    "Mylo Xyloto",
    "2011-10-24",
    "1G4isv_Fylg",
    261,
    "English",
    "Alternative",
  ],
] as const;
export function seedData(fixture = false, passwordHash = "", now = new Date()) {
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
  const genres = names.map((name) => ({
    ...base,
    genreId: seedId("genre:" + name),
    name,
    slug: name.toLowerCase(),
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
    : music.map((r, i) => ({
        ...base,
        artistId: seedId("real-artist:" + i),
        name: r[1],
        searchName: normalize(r[1]),
        genreIds: [genres.find((g) => g.name === r[7])!.genreId],
        bio: "Explore their music on Resonance.",
        country: "",
      }));
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
    : music.map((r, i) => ({
        ...base,
        albumId: seedId("real-album:" + i),
        title: r[2],
        searchTitle: normalize(r[2]),
        artistIds: [artists[i].artistId],
        releaseDate: new Date(r[3]),
        type: "album",
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
    : music.map((r, i) => ({
        ...base,
        songId: seedId("real-song:" + i),
        title: r[0],
        searchTitle: normalize(r[0]),
        artistCredits: [{ artistId: artists[i].artistId, role: "primary" }],
        albumId: albums[i].albumId,
        genreIds: [genres.find((g) => g.name === r[7])!.genreId],
        durationSec: r[5],
        language: r[6],
        trackNumber: 1,
        discNumber: 1,
        media: { provider: "youtube", videoId: r[4] },
        provenance: {
          catalog: "curated-demo",
          duration: "video duration; verify in player",
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
