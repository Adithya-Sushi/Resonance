# Resonance

A classroom music discovery application built with React, Express, MongoDB, Neo4j, and the official YouTube embedded player. Audio/video bytes are never downloaded or stored by this application.

## Start locally

Requirements: Docker Desktop, Node.js 24 LTS, npm, and internet access for YouTube playback. The original project PDF and existing `output/` and `tmp/` documents are preserved locally and excluded from this source repository.

```sh
cp .env.example .env   # first setup only; do not overwrite an existing .env
npm ci
docker compose up -d mongo neo4j
npm run db:init
npm run seed          # refuses to replace an existing dataset
npm run dev
```

Open **http://127.0.0.1:5173**. The API runs on port 4000; Neo4j Browser is at http://127.0.0.1:7474. Wait for both databases to become healthy on the first launch. Neo4j's first start downloads the pinned GDS plugin.

| Account | Email | Default local demo password |
| --- | --- | --- |
| Administrator | admin@resonance.local | ResonanceDemo!2026 |
| Listener | listener@resonance.local | ResonanceDemo!2026 |

`SEED_PASSWORD` changes the password used for newly seeded accounts. The 500 initial listening sessions are synthetic and labeled in the history screen. The actual playable catalog contains real YouTube videos. Availability can change by uploader, region, or account; the player reports unavailable videos and offers an external YouTube link.

## Automated music importing

1. In Google Cloud Console, enable **YouTube Data API v3** and create an API key restricted to this API.
2. Put the key in the root `.env` as `YOUTUBE_API_KEY=...`. Never put it in a frontend `VITE_` variable or commit it.
3. Set `MUSICBRAINZ_CONTACT` to an identifying project contact. MusicBrainz public metadata does not require an API key.
4. Restart the API and worker after changing environment variables.
5. Sign in as administrator → **Admin studio → Import music**. Paste a public YouTube playlist or video URLs.
6. Select **Prepare import**. The worker paginates playlists, deduplicates IDs, fetches metadata, and searches MusicBrainz at no more than one request per second.
7. Review suggestions. Choose the correct recording/release, fill missing language/date/genre details, and save each reviewed row. Then publish the reviewed rows together.

Choosing a recording/release also retrieves available genres and release-specific disc/track positions. Review multiple performer credits and their roles. Checkboxes let you publish a subset of reviewed rows; large selections are sent in batches of 200. API lookups and background searches share a MongoDB rate-limit lease.

Import status and partial progress survive restarts. Publication is atomic per row, not across the entire batch; valid rows can succeed while another row needs correction. Duplicate imports return the existing song. Missing, private, live, or non-embeddable videos cannot be published through import. Network and quota errors are resumable through **Retry processing**. A fetched embedding flag does not guarantee playback in every viewer's region.

The video title, channel, and upload date are distinct from the reviewed song, performer, and release metadata. Existing artists/albums are reused by MusicBrainz IDs or explicit admin selection, never by display-name equality alone. Artist and release metadata can also be entered manually in the Catalog tab.

## Run everything in Docker

```sh
docker compose --profile app up -d --build
# On a fresh database:
docker compose exec api npm run seed
```

Open **http://localhost:4000**. The API serves the built frontend. The local setup binds exposed services to loopback. MongoDB runs a single-node replica set for transactions. It deliberately uses a local unauthenticated database, not a production/public deployment. Do not publish these ports externally. Neo4j uses the password from `.env`.

Stop `npm run dev` before switching to Docker app services, since both use port 4000 and the same worker lease. On an existing database, omit the seed command. To switch back, run `docker compose stop api worker` before `npm run dev`.

## Commands

| Command | Purpose |
| --- | --- |
| `npm run dev` | Frontend, API, and one synchronization/import worker |
| `npm run build` | Typecheck all code and build frontend |
| `npm test` | Deterministic domain/projection tests; integration tests skipped |
| `docker compose -f compose.test.yaml -p resonance-test up -d` | Isolated graph database for integration tests |
| `npm run test:integration` | Real MongoDB transaction and Neo4j/GDS checks in separate test databases |
| `npm run test:e2e` | Desktop/mobile tests with Chrome, isolated API/database, and deterministic player adapter |
| `npm run test:recovery` | Stop/restart only the isolated test Neo4j service and verify durable retry/recovery |
| `npm run catalog:refresh-demo` | Replace the original 14 blocked demo songs transactionally; keep Faded, accounts and history; update playlist entries |
| `npx tsx scripts/check-demo-playback.ts` | Opt-in real YouTube playback/checkpoint check in Chrome; records short listens in the demo listener account |
| `npm run fixtures` | Exact PDF fixtures in `resonance_fixtures`; no playable fictional songs |
| `npm run rebuild` | Queue a rebuild for the existing worker |
| `npm run benchmark` | Record catalog/recommendation latency and hardware in `docs/benchmark.json` |
| `npm run seed -- --reset` | **Destructive:** replace domain data in the selected project database; explicit operator use only |

Integration and browser tests create distinct `resonance_test_*` / `resonance_e2e_*` databases so they do not overwrite the demo. Most tests leave their databases for inspection; catalog migration tests remove their own `resonance_catalog_test_*` database. Remove only test databases you no longer need using MongoDB tools. The test Neo4j database is disposable and separate from the demo graph.

## Project layout

- `apps/web`: music interface, player, and admin studio.
- `apps/api`: REST API, authentication, catalog/import services, query definitions, database initialization, and seed data.
- `apps/worker`: current-state graph projection, GDS algorithms, resumable cleanup, and import processing.
- `packages/shared`: request schemas, identifiers, URL parsing, and playback calculations.
- `tests`: unit, database integration, and browser tests.
- `docs`: architecture, query contracts, API reference, operational instructions, and verification evidence.

Read [Architecture](docs/architecture.md), [Query catalog](docs/queries.md), [Demo walkthrough](docs/demo.md), [Operations](docs/operations.md), and [Verification](docs/verification.md). Machine-readable API documentation is served at `/api/v1/openapi.json`.

The current 15-song demo catalog and metadata sources are documented in [docs/demo-catalog.md](docs/demo-catalog.md). For an existing installation, run `npm run catalog:refresh-demo` after updating the source. This command does not reset the database. Refresh the browser to load the new catalog.
