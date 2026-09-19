# Verification evidence

Generated test logs and benchmark JSON files referenced below are local artifacts excluded from Git. Run the reproduction commands to generate them in a fresh checkout.

Verified on 19 September 2026 (Asia/Kolkata). Machine: Apple M4, 10 logical CPUs, 16 GB RAM, macOS arm64. Host test runtime: Node 25.6.1. The production image builds and runs with the pinned Node **24.11.0** runtime, MongoDB **8.0.16**, Neo4j **5.26.0 Community**, and GDS **2.13.2**.

## Automated checks

| Check | Result | Scope |
| --- | --- | --- |
| TypeScript and production build | Passed | Shared, API, worker and frontend; lazy admin bundle |
| `npm test` | 28 passed | URL parsing, telemetry/seek coverage, playlist invariants, exact fixture topology and trend regression |
| `npm run test:integration` | 44 passed | Real MongoDB replica-set transactions and separate Neo4j/GDS database |
| `npm run test:e2e` | 12 passed | Six workflows each at desktop and mobile sizes in installed Chrome |
| axe WCAG 2 A/AA and 2.1 AA checks | No detected violations on tested pages | Discovery and login on both sizes; also keyboard focus trapping, Escape and focus restoration |
| `npm run test:recovery` | Passed | Actual stop/start of isolated Neo4j service, durable writes, fallback, retry and replay |
| `npm audit` | 0 reported vulnerabilities | Exact lockfile after security updates; point-in-time registry audit |
| Docker Compose deployment | Passed | Built images, healthy databases, running API and single worker |

The 44 database checks include all A1–A6 and C1–C10 queries compared with independent source calculations, real persisted **808 domain records / 228 graph nodes / 1,260 relationships**, GDS distinct-listener degree checks, and the seven-day case where **101 lifetime plays must produce only 1 recent play**. They also cover session/CSRF authorization, private playlists, conflicting playlist updates/deletion, invalid references, retirement, idempotent finalization, interrupted sessions, opt-out, analytics invalidation, deletion and repeated graph rebuilds.

Importer checks use controlled provider responses: playlist pagination, duplicate IDs, missing/private/non-embeddable videos, quota failure, resumability, recording/release conflicts, metadata enrichment, incomplete metadata, mixed publication outcomes, rollback, retry deduplication, and expired-cache removal while preserving authored information.

Browser workflows cover search, playlist creation and repeated songs, history navigation, missing-key messaging, a persistent visible player, and checkpoint submission using a deterministic YouTube adapter. This adapter verifies application behavior; it is not evidence of actual YouTube service availability.

Captured console results are in `docs/test-evidence.txt`. The last browser HTML report is generated locally at `playwright-report/index.html`; it is excluded from the source image and version control.

## Real provider and visual checks

The actual YouTube IFrame player played **Alan Walker — Faded** (`60ItHLz5WEA`) in the browser, including the Docker-served application at `http://127.0.0.1:4000`. Playback progressed past 1:38, pause worked, and the application stored real checkpoints alongside explicitly synthetic seed history. Discovery, administration and the interactive graph were also inspected visually.

On 19 September 2026, the 14 original demo videos other than Faded were replaced with individually checked NCS uploads. Every selected video reached PLAYING and advanced beyond three seconds using the real official YouTube IFrame API in installed Chrome. Several candidates returned error 150 and were rejected. This is a point-in-time local check, not a guarantee for other regions or future uploader restrictions. See [catalog and sources](demo-catalog.md).

Live YouTube Data API importing has **not** been exercised because no user API key was supplied. Configure `YOUTUBE_API_KEY` and `MUSICBRAINZ_CONTACT`, recreate the API/worker containers, then follow the import walkthrough. Public MusicBrainz reads require no API key. Matching always requires admin review; genres, languages and complete dates may remain unavailable.

## Measured performance

`docs/http-benchmark.json` records 100 sequential warm authenticated requests to the Docker API over loopback:

| Metric | Measured | PDF target |
| --- | ---: | ---: |
| Catalog response p95 | 6.12 ms | < 500 ms |
| Recommendation response p95 | 31.05 ms | < 2,000 ms |
| Ordinary outbox synchronization | 1,451 ms | < 10,000 ms |

The prefix-search explain plan used `searchTitle_1_status_1` with one document and two keys examined for one returned match. `docs/benchmark.json` separately records service-only latency and machine details. These are small local demonstration measurements, not load tests or guarantees at production scale; they exclude YouTube transfer/playback latency.

`docs/recovery.json` records a real graph outage. MongoDB accepted a catalog write with its outbox task; recommendations returned through fallback in 16 ms. The first failure remained pending. The prior counter was deliberately set to nine to test the tenth-attempt failed state without waiting through backoff. After restart, the graph converged and replay preserved absolute totals.

## Reproduce

```sh
npm run build
npm test
docker compose -f compose.test.yaml -p resonance-test up -d
npm run test:integration
npm run test:e2e
npm run test:recovery
npm audit
# With the Docker app running:
npx tsx scripts/http-check.ts
```

Run integration and recovery sequentially: they intentionally share the isolated test graph on port 7688. Their MongoDB databases are separate from the playable `resonance` database. The HTTP check creates and deletes only its own temporary playlist. A full accessibility certification, broad browser matrix and high-concurrency stress testing remain beyond the recorded checks.

## Playback failure regression

The Queen video `fJ9rUzIMcZQ` returned YouTube error 150 during a live browser check: embedding was disallowed. Faded continued to play normally. The transport now disables playback for a failed video and places an explanation and YouTube link beside the controls. Desktop/mobile regression tests cover error 150, visible feedback, switching to a working song, and pause/resume. A selected song also waits for player readiness before enabling the transport.

## Catalog replacement regression

Three additional real MongoDB transaction tests cover preservation of Faded, historical song identity, playlist ordering and repeated entries; idempotent reruns; rollback on duplicate imported videos; and protection of manually customized original videos. The live migration inserted 14 songs, retired 14 originals, and changed 45 entries across 8 playlists. Accounts and existing playback-session documents were verified unchanged. A second run performed zero changes. Original artists/albums remain available for historical references; follows are not reassigned to unrelated artists.

The post-migration real-provider check passed **15/15 tracks** in the Docker-served app at `http://127.0.0.1:4000`, using Chrome 153.0.8010.48 at 00:15 UTC on 19 September 2026. Each song advanced beyond three seconds and saved a successful nonzero listening checkpoint. No provider responses were mocked. Local details are in `tmp/demo-playback-check.json`; reproduce with `npx tsx scripts/check-demo-playback.ts`. The updated catalog also passed all 28 domain tests, 44 database tests and 12 desktop/mobile browser checks.
