// Curated music credits and label release dates; upload dates are not release dates.
// Playback was checked with the official YouTube IFrame API; availability can change.
import { catalogAdditions } from "./catalog-additions.js";
import { additionalTwenty } from "./catalog-additions-20.js";
export interface DemoTrack {
  readonly title: string;
  readonly artists: readonly {
    readonly name: string;
    readonly role: "primary" | "featured";
  }[];
  readonly album: string;
  readonly releaseDate: string;
  readonly videoId: string;
  readonly durationSec: number;
  readonly language: string;
  readonly source: string;
  readonly releaseSource: string;
  readonly checkedAt: string;
  readonly legacyVideoId?: string;
  readonly genres: readonly string[];
}
export const originalDemoCatalog: readonly DemoTrack[] = [
  {
    genres: ["Electronic"],
    title: "Invincible",
    artists: [
      {
        name: "DEAF KEV",
        role: "primary",
      },
    ],
    album: "Invincible",
    releaseDate: "2015-05-14",
    videoId: "J2X5mJ3HDYE",
    durationSec: 273,
    language: "Instrumental",
    source: "https://ncs.io/invincible",
    releaseSource: "https://ncs.io/artist/103/deaf-kev",
    checkedAt: "2026-09-19T00:07:33.481Z",
    legacyVideoId: "dQw4w9WgXcQ",
  },
  {
    genres: ["Electronic"],
    title: "Blank",
    artists: [
      {
        name: "Disfigure",
        role: "primary",
      },
    ],
    album: "Blank",
    releaseDate: "2013-05-01",
    videoId: "p7ZsBPK656s",
    durationSec: 209,
    language: "Instrumental",
    source: "https://ncs.io/blank",
    releaseSource: "https://ncs.io/artist/113/disfigure",
    checkedAt: "2026-09-19T00:07:33.481Z",
    legacyVideoId: "JGwWNGJdvx8",
  },
  {
    genres: ["Electronic"],
    title: "On & On",
    artists: [
      {
        name: "Cartoon",
        role: "primary",
      },
      {
        name: "Jéja",
        role: "primary",
      },
      {
        name: "Daniel Levi",
        role: "featured",
      },
    ],
    album: "On & On",
    releaseDate: "2015-07-09",
    videoId: "K4DyBUG242c",
    durationSec: 208,
    language: "English",
    source: "https://ncs.io/onandon",
    releaseSource: "https://ncs.io/artist/73/cartoon",
    checkedAt: "2026-09-19T00:07:33.481Z",
    legacyVideoId: "kJQP7kiw5Fk",
  },
  {
    genres: ["Electronic"],
    title: "Heroes Tonight",
    artists: [
      {
        name: "Janji",
        role: "primary",
      },
      {
        name: "Johnning",
        role: "featured",
      },
    ],
    album: "Heroes Tonight",
    releaseDate: "2015-06-09",
    videoId: "3nQNiWdeH2Q",
    durationSec: 208,
    language: "English",
    source: "https://ncs.io/ht",
    releaseSource: "https://ncs.io/artist/198/janji",
    checkedAt: "2026-09-19T00:07:33.481Z",
    legacyVideoId: "fJ9rUzIMcZQ",
  },
  {
    genres: ["Electronic"],
    title: "Sky High",
    artists: [
      {
        name: "Elektronomia",
        role: "primary",
      },
    ],
    album: "Sky High",
    releaseDate: "2016-12-28",
    videoId: "TW9d8vYrVFQ",
    durationSec: 238,
    language: "Instrumental",
    source: "https://ncs.io/skyhigh",
    releaseSource: "https://ncs.io/artist/129/elektronomia",
    checkedAt: "2026-09-19T00:07:33.481Z",
    legacyVideoId: "OPf0YbXqDm0",
  },
  {
    genres: ["Electronic"],
    title: "Feel Good",
    artists: [
      {
        name: "Syn Cole",
        role: "primary",
      },
    ],
    album: "Feel Good",
    releaseDate: "2016-02-27",
    videoId: "q1ULJ92aldE",
    durationSec: 182,
    language: "Instrumental",
    source: "https://ncs.io/feelgood",
    releaseSource: "https://ncs.io/artist/434/syn-cole",
    checkedAt: "2026-09-19T00:07:33.481Z",
    legacyVideoId: "09R8_2nJtjg",
  },
  {
    genres: ["Electronic"],
    title: "Firefly",
    artists: [
      {
        name: "Jim Yosef",
        role: "primary",
      },
    ],
    album: "Firefly",
    releaseDate: "2015-06-28",
    videoId: "x_OwcYTNbHs",
    durationSec: 256,
    language: "Instrumental",
    source: "https://ncs.io/jyfirefly",
    releaseSource: "https://ncs.io/artist/210/jim-yosef",
    checkedAt: "2026-09-19T00:07:33.481Z",
    legacyVideoId: "hT_nvWreIhg",
  },
  {
    genres: ["Electronic"],
    title: "My Heart",
    artists: [
      {
        name: "Different Heaven",
        role: "primary",
      },
      {
        name: "EH!DE",
        role: "primary",
      },
    ],
    album: "My Heart",
    releaseDate: "2013-11-13",
    videoId: "jK2aIUmmdP4",
    durationSec: 267,
    language: "English",
    source: "https://ncs.io/myheart",
    releaseSource: "https://ncs.io/artist/110/different-heaven",
    checkedAt: "2026-09-19T00:07:33.481Z",
    legacyVideoId: "YQHsXMglC9A",
  },
  {
    genres: ["Electronic"],
    title: "Mortals",
    artists: [
      {
        name: "Warriyo",
        role: "primary",
      },
      {
        name: "Laura Brehm",
        role: "featured",
      },
    ],
    album: "Mortals",
    releaseDate: "2016-12-15",
    videoId: "yJg-Y5byMMw",
    durationSec: 230,
    language: "English",
    source: "https://ncs.io/mortals",
    releaseSource: "https://ncs.io/artist/486/warriyo",
    checkedAt: "2026-09-19T00:07:33.481Z",
    legacyVideoId: "CevxZvSJLk8",
  },
  {
    genres: ["Electronic"],
    title: "Shine",
    artists: [
      {
        name: "Spektrem",
        role: "primary",
      },
    ],
    album: "Shine",
    releaseDate: "2013-05-05",
    videoId: "n4tK7LYFxI0",
    durationSec: 259,
    language: "Instrumental",
    source: "https://ncs.io/shine",
    releaseSource: "https://ncs.io/artist/416/spektrem",
    checkedAt: "2026-09-19T00:08:47.203Z",
    legacyVideoId: "RBumgq5yVrA",
  },
  {
    genres: ["Electronic"],
    title: "Faded",
    artists: [
      {
        name: "Alan Walker",
        role: "primary",
      },
    ],
    album: "Different World",
    releaseDate: "2018-12-14",
    videoId: "60ItHLz5WEA",
    durationSec: 213,
    language: "English",
    source: "https://www.youtube.com/watch?v=60ItHLz5WEA",
    releaseSource: "Original curated Different World album metadata",
    checkedAt: "2026-09-19T00:07:33.481Z",
    legacyVideoId: "60ItHLz5WEA",
  },
  {
    genres: ["Electronic"],
    title: "Nekozilla",
    artists: [
      {
        name: "Different Heaven",
        role: "primary",
      },
    ],
    album: "Nekozilla",
    releaseDate: "2016-11-20",
    videoId: "6FNHe3kf8_s",
    durationSec: 166,
    language: "Instrumental",
    source: "https://ncs.io/nekozilla",
    releaseSource: "https://ncs.io/artist/110/different-heaven",
    checkedAt: "2026-09-19T00:08:47.203Z",
    legacyVideoId: "pRpeEdMmmQ0",
  },
  {
    genres: ["Electronic"],
    title: "Symbolism",
    artists: [
      {
        name: "Electro-Light",
        role: "primary",
      },
    ],
    album: "Symbolism",
    releaseDate: "2014-11-27",
    videoId: "__CRWE-L45k",
    durationSec: 291,
    language: "Instrumental",
    source: "https://ncs.io/symbolism",
    releaseSource: "https://ncs.io/artist/127/electro-light",
    checkedAt: "2026-09-19T00:08:47.203Z",
    legacyVideoId: "kXYiU_JCYtU",
  },
  {
    genres: ["Electronic"],
    title: "Link",
    artists: [
      {
        name: "Jim Yosef",
        role: "primary",
      },
    ],
    album: "Link",
    releaseDate: "2017-05-20",
    videoId: "9iHM6X6uUH8",
    durationSec: 224,
    language: "Instrumental",
    source: "https://ncs.io/Link",
    releaseSource: "https://ncs.io/artist/210/jim-yosef",
    checkedAt: "2026-09-19T00:08:47.203Z",
    legacyVideoId: "9bZkp7q19f0",
  },
  {
    genres: ["Electronic"],
    title: "Why We Lose",
    artists: [
      {
        name: "Cartoon",
        role: "primary",
      },
      {
        name: "Jéja",
        role: "primary",
      },
      {
        name: "Coleman Trapp",
        role: "featured",
      },
    ],
    album: "Why We Lose",
    releaseDate: "2015-06-11",
    videoId: "zyXmsVwZqX4",
    durationSec: 213,
    language: "English",
    source: "https://ncs.io/whywelose",
    releaseSource: "https://ncs.io/artist/73/cartoon",
    checkedAt: "2026-09-19T00:08:47.203Z",
    legacyVideoId: "1G4isv_Fylg",
  },
];
export const demoCatalog: readonly DemoTrack[] = [
  ...originalDemoCatalog,
  ...catalogAdditions,
  ...additionalTwenty,
];
