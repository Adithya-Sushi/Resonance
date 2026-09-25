# Original playable demo catalog

The application now contains **50 tracks**. This page documents the first 15; see [35-track expansion](catalog-expansion.md) for the additions and listener demonstration.

The seed contains Faded plus 14 replacement tracks checked on 19 September 2026. Music streams only through the visible official YouTube player. No media is stored locally.

Credits and single release dates come from the linked NCS catalog/artist pages (label catalog dates, which can differ from earlier releases). They are not inferred from channels or YouTube upload dates. Faded retains its existing Different World album association. Single releases use track/disc 1. Video durations were measured from the IFrame player and rounded to seconds. Curated credits share explicit artist identities, including featured artists.

| Track | Artist credits | Video | Metadata source |
| --- | --- | --- | --- |
| Invincible | DEAF KEV | [YouTube](https://www.youtube.com/watch?v=J2X5mJ3HDYE) | [Catalog](https://ncs.io/invincible) |
| Blank | Disfigure | [YouTube](https://www.youtube.com/watch?v=p7ZsBPK656s) | [Catalog](https://ncs.io/blank) |
| On & On | Cartoon, Jéja, Daniel Levi (featured) | [YouTube](https://www.youtube.com/watch?v=K4DyBUG242c) | [Catalog](https://ncs.io/onandon) |
| Heroes Tonight | Janji, Johnning (featured) | [YouTube](https://www.youtube.com/watch?v=3nQNiWdeH2Q) | [Catalog](https://ncs.io/ht) |
| Sky High | Elektronomia | [YouTube](https://www.youtube.com/watch?v=TW9d8vYrVFQ) | [Catalog](https://ncs.io/skyhigh) |
| Feel Good | Syn Cole | [YouTube](https://www.youtube.com/watch?v=q1ULJ92aldE) | [Catalog](https://ncs.io/feelgood) |
| Firefly | Jim Yosef | [YouTube](https://www.youtube.com/watch?v=x_OwcYTNbHs) | [Catalog](https://ncs.io/jyfirefly) |
| My Heart | Different Heaven, EH!DE | [YouTube](https://www.youtube.com/watch?v=jK2aIUmmdP4) | [Catalog](https://ncs.io/myheart) |
| Mortals | Warriyo, Laura Brehm (featured) | [YouTube](https://www.youtube.com/watch?v=yJg-Y5byMMw) | [Catalog](https://ncs.io/mortals) |
| Shine | Spektrem | [YouTube](https://www.youtube.com/watch?v=n4tK7LYFxI0) | [Catalog](https://ncs.io/shine) |
| Faded | Alan Walker | [YouTube](https://www.youtube.com/watch?v=60ItHLz5WEA) | [Catalog](https://www.youtube.com/watch?v=60ItHLz5WEA) |
| Nekozilla | Different Heaven | [YouTube](https://www.youtube.com/watch?v=6FNHe3kf8_s) | [Catalog](https://ncs.io/nekozilla) |
| Symbolism | Electro-Light | [YouTube](https://www.youtube.com/watch?v=__CRWE-L45k) | [Catalog](https://ncs.io/symbolism) |
| Link | Jim Yosef | [YouTube](https://www.youtube.com/watch?v=9iHM6X6uUH8) | [Catalog](https://ncs.io/Link) |
| Why We Lose | Cartoon, Jéja, Coleman Trapp (featured) | [YouTube](https://www.youtube.com/watch?v=zyXmsVwZqX4) | [Catalog](https://ncs.io/whywelose) |

## Updating an existing demo

Run `npm run catalog:refresh-demo` against the local playable database. For Docker, rebuild the app image first and run `docker compose exec api npm run catalog:refresh-demo`.

The migration creates new song identities, retires only the original 14 seeded videos, and updates playlist entries without changing their entry IDs, ordering, or repetition. Playlist versions advance so stale editors receive a conflict. Accounts, follows, and historical listening sessions remain unchanged; old listens still refer to the original recordings. Original artist and album records remain for those references. Faded is not rewritten.

All changes and graph outbox tasks commit in one MongoDB transaction. The existing worker reconciles the graph and refreshes analytics. Rerunning is a no-op. Customized original video IDs, retired replacement records, or imported duplicates cause the transaction to abort for review. The separate 808-record database fixtures are unchanged.

## Checking provider playback again

With the app running and installed Chrome available:

```sh
npx tsx scripts/check-demo-playback.ts
```

This opt-in check uses the real app UI, waits for each video to play past three seconds, pauses it, and checks successful listening checkpoint submission. It creates short real listening sessions in the demo listener account. It saves a local report in `tmp/demo-playback-check.json`. Override `PLAYBACK_CHECK_URL`, `PLAYBACK_CHECK_EMAIL`, and `SEED_PASSWORD` for a different local installation. Playback permission can change; a successful check is not a permanent availability guarantee.
