# Classroom demo walkthrough

1. Start databases, seed once, and run the app. Explain that MongoDB owns state and Neo4j is a derived graph. The original PDF and revised architecture are in the project.
2. Sign in as `listener@resonance.local`. Search by song/artist/album prefix; apply genre, language, or release-year filters. Open an artist and follow/unfollow.
3. Play a real YouTube track. Show the visible player, pause/resume, next, and playback persistence across routes. Seek near the end and explain why unique coverage differs from current position.
4. Create a playlist, add the same song twice, move one entry, and change visibility. Each occurrence has a distinct entry ID. Two simultaneous edits with one version produce one success and one conflict, demonstrated by the integration suite.
5. Open history and listening statistics. Distinguish synthetic seed sessions from real attempts. Metrics belong to Resonance, not YouTube.
6. Sign in as `admin@resonance.local`. In Catalog, create/edit artists, albums, and songs. Preview a YouTube video; show rejection when retiring an album with an active song.
7. With a configured API key, import a public YouTube playlist. Review MusicBrainz recording/release candidates, correct ambiguous metadata, and publish reviewed rows. Reimport to demonstrate video-ID deduplication. Without a key, demonstrate the clear configuration error and the provider-mocked integration tests without claiming a live import occurred.
8. Show A1–A6, C1–C10, the GDS degree and similarity output, and the interactive graph. Inspect nodes/edges and explain pseudonymous users, public playlists, and graph directions.
9. Stop only the demo Neo4j service (`docker compose stop neo4j`). Create or rename a playlist: MongoDB still succeeds. Recommendations fall back; outbox work remains durable. Restart Neo4j (`docker compose start neo4j`) and inspect convergence. Use Retry failed tasks if needed.
10. Toggle recommendation participation off; show removal of user-derived graph state after synchronization while private app features remain available. Use a disposable account when demonstrating deletion.

## Exact PDF fixture dataset

`npm run fixtures` seeds `resonance_fixtures`, leaving the playable database unchanged. It has 20 users, 20 artists, 30 albums, 120 songs, 30 playlists, 500 sessions, 80 follows, and 8 genres: 808 authoritative records. The pure projection and real database query tests assert 228 nodes and 1,260 relationships (including 350 listening pairs, 140 performer credits, and 300 playlist entries). Fictional fixture songs have provider `fixture`, are excluded from the playable catalog, and cannot start playback.

The demo database has different catalog/relationship counts because it uses real music. Do not represent those as the exact fixture counts. Keep the fixture graph in the separate test Neo4j instance when projecting it for a presentation.
