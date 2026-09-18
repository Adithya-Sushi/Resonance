import "dotenv/config";
const fixture = process.argv.includes("--fixtures");
if (fixture) process.env.MONGO_DB = "resonance_fixtures";
const { collection, initDb, closeDb, transaction, outbox } = await import(
  "./db.js"
);
const { seedData } = await import("./seed-data.js");
const { default: argon2 } = await import("argon2");
try {
  await initDb();
  const existing = await collection("users").countDocuments();
  if (existing && !process.argv.includes("--reset"))
    throw new Error(
      "Database already has data. Pass --reset only to replace this project’s seed database.",
    );
  const data = seedData(
    fixture,
    await argon2.hash(process.env.SEED_PASSWORD || "ResonanceDemo!2026", {
      type: argon2.argon2id,
    }),
  );
  await transaction(async (s) => {
    for (const [name, rows] of Object.entries(data)) {
      await collection(name).deleteMany({}, { session: s });
      await collection(name).insertMany(rows, { session: s });
    }
    for (const name of [
      "sync_outbox",
      "app_state",
      "auth_sessions",
      "import_jobs",
    ])
      await collection(name).deleteMany({}, { session: s });
    await outbox(s, "rebuild", "seed");
  });
  console.log(
    JSON.stringify(
      {
        database: fixture
          ? "resonance_fixtures"
          : process.env.MONGO_DB || "resonance",
        counts: Object.fromEntries(
          Object.entries(data).map(([k, v]) => [k, v.length]),
        ),
        note: "Listening history is synthetic. Fixture songs are not playable.",
      },
      null,
      2,
    ),
  );
} finally {
  await closeDb();
}
