# Operations

## Startup and health

Start Docker Desktop. Run `docker compose up -d mongo neo4j`, then `docker compose ps`. MongoDB's health command initializes replica set `rs0`; local host connections use directConnection while containers use the internal replica-set address. Neo4j Community 5.26.0 uses GDS 2.13.2, which fixes the Community startup incompatibility in 2.13.1.

`npm run db:init` creates validators/indexes/constraints; `npm run seed` loads the initial data only into an empty database. `npm run dev` starts the API, Vite, and the single worker. The admin overview shows pending/failed counts, oldest pending age, last successful sync, import-key configuration, and reference-quality checks.

A failed GDS download must not be used as a plugin: the startup script downloads to a temporary path, promotes only a completed download, and checks that the jar is nonempty. If the first startup loses its network connection, retry `docker compose up -d neo4j` after connectivity returns. Inspect `docker compose logs neo4j` for errors.

## Recovery

Outbox failures back off exponentially and remain stored. Start Neo4j, then use the admin retry button or POST `/api/v1/admin/retry` with an admin session and CSRF token. This resets failed work for retry. `npm run rebuild` / POST `/admin/reconcile` queues a current-state rebuild for the existing worker. Do not run competing manual graph writers.

The full graph replacement is committed atomically. A failure before commit preserves the previous graph. A failure after commit but before MongoDB acknowledgement repeats the same current-state projection. Analytics refresh failures do not erase the last complete result. All pending tasks are inspectable in MongoDB.

Account cleanup is resumable in bounded batches. `deleting` accounts cannot log in or write. A `deleted` tombstone means source cleanup and graph removal have completed. If Neo4j is unavailable the account remains disabled with cleanup pending rather than falsely reporting full deletion.

## Import failures

A job preserves completed rows and its discovery cursor. Retry after quota reset or network recovery. A ready row with no MusicBrainz suggestions can be filled manually. All required song/artist/album metadata must validate before publishing. A publication failure rolls back that row's newly created references. Other selected rows can still publish.

YouTube API data carries expiry and provenance. A worker refresh attempts metadata renewal and removes expired cached data if renewal is unavailable. Reviewed catalog fields are maintained separately. Runtime video failures can still occur despite import-time availability checks.

## Local-only deployment

The Compose configuration exposes services only at 127.0.0.1. MongoDB is unauthenticated in this classroom setup. Public hosting, HTTPS termination, database authentication, provider audits, production backups, and multiple-worker coordination are not included. Browser requests use same-origin APIs. Cookies can be marked Secure with `COOKIE_SECURE=true` when HTTPS is supplied.

Never commit `.env`, API keys, or generated password secrets. Restart processes after environment changes. A production build uses the root `.env`, not an environment file inside a workspace package.

## Reproducible recovery check

Start the isolated graph with `docker compose -f compose.test.yaml -p resonance-test up -d`, then run `npm run test:recovery`. This script stops only `neo4j-test`, commits a MongoDB catalog change and outbox task, confirms recommendation fallback and failed-task surfacing, starts the test graph, and verifies replay without double-counting. It leaves the demo graph untouched and writes `docs/recovery.json`. Do not run it concurrently with integration tests because they share the test graph.
