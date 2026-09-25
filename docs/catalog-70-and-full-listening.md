# 70-song catalog and full-length listening demonstration

## Second catalog addition

Added 20 verified recordings to the existing 50-song catalog. The 20 additions have 33 credited artists and 19 overlapping genre tags. The live transaction inserted 25 artists, 20 single releases, 20 songs and 13 genres, and added genre memberships to six existing curated artists. It preserved all existing accounts, songs, follows, playlists and playback sessions; its second run made zero changes.

Credits, genre tags and release dates come from the official label catalog. Video titles supplied additional genre/featured-credit evidence where available. Labels can overlap: for example, Hold You is catalogued as Chill while the official video is tagged Future Trap. Language remains Undetermined unless independently confirmed. No media files are downloaded or stored.

| Song | Credits | Genre tags | Metadata | Playback |
| --- | --- | --- | --- | --- |
| Hold You | Low Mileage | Chill, Future Trap | [NCS](https://ncs.io/holdyou) | [YouTube](https://www.youtube.com/watch?v=-ZUUF-J2U4s) |
| Driver Seat | C1W | Chill, Deep House | [NCS](https://ncs.io/driverseat) | [YouTube](https://www.youtube.com/watch?v=_zvzWG9tKzI) |
| Keep Me Closer | Low Mileage | Chill, Breakbeat | [NCS](https://ncs.io/keepmecloser) | [YouTube](https://www.youtube.com/watch?v=dVteKLjhKFM) |
| Where'd You Go | Luna Lark (featured), Julius Dreisig | Chill, Future Bass | [NCS](https://ncs.io/WYG) | [YouTube](https://www.youtube.com/watch?v=aWJJEaod34U) |
| Blindfold | Warriyo, Laura Brehm | Melodic Dubstep, Future Trap | [NCS](https://ncs.io/blindfold) | [YouTube](https://www.youtube.com/watch?v=uNRX08JOt6c) |
| Need You Again | SadBois, ROY KNOX, Jake Neumar | Melodic Dubstep | [NCS](https://ncs.io/needyouagain) | [YouTube](https://www.youtube.com/watch?v=Rg6QsFkTmWg) |
| Dancefloor Dreamer | NIVIRO | Trance | [NCS](https://ncs.io/DancefloorDreamer) | [YouTube](https://www.youtube.com/watch?v=NlLaMri0Fow) |
| The Sky High | Elektronomia | Melodic House | [NCS](https://ncs.io/theskyhigh) | [YouTube](https://www.youtube.com/watch?v=cuvGry0ppBA) |
| Another Way | KDH, Syn Cole, Vikkstar, Joe Jury | Melodic House, House | [NCS](https://ncs.io/AnotherWay) | [YouTube](https://www.youtube.com/watch?v=CTyuZ4qb9a0) |
| Shake You Off (feat. Shel Bee) | Maryn, Shel Bee (featured) | Indie, Indie Dance, Electronic Pop | [NCS](https://ncs.io/ShakeYouOff) | [YouTube](https://www.youtube.com/watch?v=8Z_IFKjl2Pc) |
| Without You | Valcos, Chris Linton | Indie, Indie Dance | [NCS](https://ncs.io/WithoutYou) | [YouTube](https://www.youtube.com/watch?v=wdpGocMoipw) |
| Round n' Round | Shiah Maisel, Clarx | Electronic Rock | [NCS](https://ncs.io/RoundNRound) | [YouTube](https://www.youtube.com/watch?v=WmyLI61sa9I) |
| Left With Nothing | Clarx, Shiah Maisel | Electronic Rock | [NCS](https://ncs.io/LeftWithNothing) | [YouTube](https://www.youtube.com/watch?v=IGkW7l-0ptE) |
| Romeo and Juliet | SadBois, Manno | Electronic Rock | [NCS](https://ncs.io/RnJ) | [YouTube](https://www.youtube.com/watch?v=zNGqtG4tjzQ) |
| Vienna (feat. PhiloSofie) | James Mercy, PhiloSofie (featured) | Electronic Rock, Trap | [NCS](https://ncs.io/Vienna) | [YouTube](https://www.youtube.com/watch?v=wJ0VVutDj4I) |
| ILYBB | Ailow, Dionysus | Hardstyle | [NCS](https://ncs.io/A_ILYBB) | [YouTube](https://www.youtube.com/watch?v=REzVa8a-Mzk) |
| On My Mind | No Hero | Hardstyle, Happy Hardcore | [NCS](https://ncs.io/OnMyMind) | [YouTube](https://www.youtube.com/watch?v=lb6jG08lRy8) |
| Complicated | WBN, WIBERG | Glitch Hop | [NCS](https://ncs.io/Complicated) | [YouTube](https://www.youtube.com/watch?v=tnRxocc7PpA) |
| Alive | Tamlin | Disco | [NCS](https://ncs.io/T_Alive) | [YouTube](https://www.youtube.com/watch?v=AeIK7C6iNsQ) |
| Boogie | Joyful, Фрози, Zachz Winner | Disco, Discoplug | [NCS](https://ncs.io/Boogie) | [YouTube](https://www.youtube.com/watch?v=kbfhyc5_y3U) |

Each video was observed in PLAYING state beyond three seconds in the official iframe on 19 September 2026. Embeddability can change over time or by region. `tmp/next-20-embeds.json` records those checks. Application-level checks are recorded separately, including retries.

## Install without resetting data

```sh
npm run catalog:expand-demo
# Equivalent in an updated Docker image:
docker compose exec api npm run catalog:expand-demo
```

This command includes both additive batches. On a 50-song installation it inserts only the final 20; on the original 15-song installation it adds 55. Fresh seeds contain all 70. Fictional fixtures retain their original 808 domain records / 228 nodes / 1,260 relationships.

## Full browser listening run

```sh
npm run demo:listen-full
# Resume only unfinished entries if a provider/network interruption stopped it:
npm run demo:listen-full -- --resume
```

The opt-in script signs in as the demo listener and plays 20 complete selections across 13 distinct songs, approximately 58.5 minutes of actual music. Fifteen plays include the established Electronic Rock/Chill preferences; five explore House, Indie/Electronic Pop, Melodic Dubstep/Future Trap and Glitch Hop. Repeated favorites create stronger song affinities. The earlier genuine listening history and the separately labeled synthetic seed history remain intact.

Every passing entry must receive a successful normal API finalization caused by YouTube’s ENDED event, with at least 98% coverage and listening time. Playback runs at normal speed without seeks, accelerated timers, injected checkpoints or database history writes. Small subsecond gaps are expected from player sampling and API startup, so 100.000% is not required. The run records each completion immediately in `tmp/full-listening-report.json`, allowing a failed run to resume without replaying completed entries.

The exact order is:

1. Severed Rose
2. Talk
3. Hold You
4. Clear My Head
5. Symphony
6. Driver Seat
7. Happier Now
8. Shake You Off (feat. Shel Bee)
9. Notice That
10. Talk
11. Round n’ Round
12. Severed Rose
13. Blindfold
14. Symphony
15. Moonlight
16. Hold You
17. Notice That
18. Complicated
19. Driver Seat
20. Talk

## What completion changes

A qualified non-skip play contributes `(listened seconds / duration) / 3` to the user–song affinity, capped at 1 across sessions. One full listen therefore contributes about 0.33, while a 45-second sample of a 217-second song contributes about 0.069. A short skip creates no positive affinity. A qualified play requires at least 30 seconds or half the duration for songs shorter than 60 seconds.

Listener similarity uses overlap of songs with positive affinity; collaborative candidate scores use neighbors’ affinities. Listening also excludes already-heard songs from discovery. Saved genre preferences and artist follows remain separate explicit inputs. Full playback strengthens the recorded song relationship; it does not silently rewrite saved genre preferences or guarantee that the recommendation list changes after every replay. The final check verifies persisted completions, graph totals, and that recommended songs are unheard and match the established tastes.

## Verified results (19 September 2026)

The run completed all **20/20 full plays** across **13 distinct tracks**, recording **3504.31 seconds (58 minutes 24 seconds)**. It ran from 2026-09-19T02:04:09.966Z to 2026-09-19T03:03:04.520Z. Every play reached the official player’s ENDED event, finalized successfully and recorded **at least 99.84% coverage**. No full-run retry, seek, accelerated clock, synthetic checkpoint or direct history write was used.

The read-only verifier matched each session’s user, video identity, duration snapshot, chronological order, completion state and listening total against MongoDB. It then independently recomputed the affected user–song totals and affinities and matched them against Neo4j. All 2,431 outbox tasks were processed; none were pending or failed at verification. Existing history remained intact.

| Play | Track | Recorded listening | Coverage |
| ---: | --- | ---: | ---: |
| 1 | Severed Rose | 156.94 s | 99.96% |
| 2 | Talk | 181.77 s | 99.88% |
| 3 | Hold You | 140.82 s | 99.87% |
| 4 | Clear My Head | 216.80 s | 99.91% |
| 5 | Symphony | 193.85 s | 99.92% |
| 6 | Driver Seat | 148.91 s | 99.94% |
| 7 | Happier Now | 179.78 s | 99.88% |
| 8 | Shake You Off (feat. Shel Bee) | 228.97 s | 99.98% |
| 9 | Notice That | 122.98 s | 99.97% |
| 10 | Talk | 181.91 s | 99.95% |
| 11 | Round n' Round | 222.99 s | 99.98% |
| 12 | Severed Rose | 156.79 s | 99.87% |
| 13 | Blindfold | 208.67 s | 99.84% |
| 14 | Symphony | 193.85 s | 99.92% |
| 15 | Moonlight | 214.84 s | 99.93% |
| 16 | Hold You | 140.86 s | 99.90% |
| 17 | Notice That | 122.90 s | 99.92% |
| 18 | Complicated | 159.97 s | 99.98% |
| 19 | Driver Seat | 148.77 s | 99.84% |
| 20 | Talk | 181.95 s | 99.97% |

The stronger signals are measurable:

| Song | Affinity before | Affinity after | Total qualified plays after |
| --- | ---: | ---: | ---: |
| Severed Rose | 0.333 | 0.999 | 3 |
| Talk | 0.333 | 1.000 | 4 |
| Clear My Head | 0.069 | 0.402 | 2 |
| Symphony | 0.129 | 0.795 | 3 |

The final graph-backed discoveries were:

| Recommendation | Genre tags | Reason |
| --- | --- | --- |
| Left With Nothing | Electronic Rock | From an artist you follow |
| Gotta Leave | Electronic Rock | From an artist you follow |
| Time Is Eating | Electronic Rock, Drumstep | In your preferred genres |
| Romeo and Juliet | Electronic Rock | In your preferred genres |
| Higher | Chill | In your preferred genres |

All five match the established Electronic Rock/Chill taste. No song completed in this run remained in the returned discovery list. Preferences and follows were retained rather than altered to force this result.

Local artifacts (excluded from Git): `tmp/full-listening-report.json`, `tmp/full-listening-verification.json`, `tmp/full-midpoint-recommendations.json`, and `tmp/full-listening-recommendations.png`. Recheck the completed run with `node --import tsx scripts/verify-full-listening.ts`. The source and metadata list in this document remain available in a fresh checkout.
