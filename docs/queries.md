# Database query catalog

Executable pipelines and Cypher live in `apps/api/src/analytics.ts`. The admin Analytics tab exposes all query IDs. Dates use a half-open `[from,to)` interval in UTC, based on session start. Responses include calculation timestamps. `npm run test:integration` executes every query against real databases.

| ID | Output and definition |
| --- | --- |
| A1 | Top songs: qualified finalized plays and distinct qualified listeners in the period. |
| A2 | Current user's seconds, qualified plays, explicit skips, sessions, and average coverage. |
| A3 | Weekly genre trends: divide each session's seconds equally across its song's genres, conserving total time. |
| A4 | Playlist engagement: group by recorded playback context, not present-day membership. Deleted playlists keep an unavailable label. |
| A5 | Credited songs, distinct albums, and full credited duration per artist. Totals are credit-based, not additive across artists. |
| A6 | Distinct qualified listeners grouped by UTC month. |
| C1 | Distinct previously heard songs ordered by latest session start. Full session history remains in MongoDB. |
| C2 | Most-listened artists using full performer credit for listening seconds. |
| C3 | Active unheard songs from followed artists. |
| C4 | Jaccard overlap of positive-affinity song sets; require two shared songs and cap at ten neighbors. |
| C5 | Unheard active songs from similar listeners, ranked by sum of neighbor similarity × song affinity. |
| C6 | Active songs sharing genres with the user's positive-affinity neighborhood. |
| C7 | Jaccard similarity between public playlists using distinct songs, unaffected by repeats. Requires playlistId. |
| C8 | Paths between distinct artists through songs/genres, at most four hops and ten returned paths. Requires artistId and otherArtistId. |
| C9 | Seven-day qualified plays at the published graph window. Lifetime plays never substitute for recent counts. |
| C10 | Active songs matching selected preferred genres; general recommendations fall back to popularity if empty. |

Affinity is `min(1, sum(playedSeconds / durationSecSnapshot) / 3)` over qualified, non-skip finalized sessions. Zero-affinity sessions remain in historical graph totals but not similarity neighborhoods. Recommendations exclude already qualified-listened tracks, use stable ID tie-breaking, and explain artist/genre connections or similar taste without revealing another listener's identity.

The separate GDS demonstrations run `gds.nodeSimilarity.stream` on User → Song positive-affinity edges and `gds.degree.stream` on reversed Song → User qualified-play edges. The latter counts distinct opted-in listeners rather than repeat plays. In-memory GDS graphs are dropped after calculation. Output timestamps and population scope appear in the admin UI.

## Indexes and constraints

Unique MongoDB domain IDs; normalized email uniqueness; user/artist follow uniqueness; genre slug uniqueness; partial unique YouTube video IDs and MusicBrainz artist/release IDs. Compound indexes cover title/name prefix search, catalog references/status, playlist ownership/date, session user/song/start, playlist source, and outbox scheduling. Independent array fields are not combined in unsupported compound multikey indexes.

Neo4j uniqueness constraints cover each of its six node domain IDs. The single writer binds valid endpoints and recreates current relationship topology atomically.
