import { createApp } from "../apps/api/src/app.js";
import { initDb, collection, closeDb } from "../apps/api/src/db.js";
import { seedData } from "../apps/api/src/seed-data.js";
import argon2 from "argon2";
if (!process.env.MONGO_DB?.startsWith("resonance_e2e_"))
  throw new Error("E2E server requires its isolated database");
await initDb();
const data = seedData(false, await argon2.hash("ResonanceDemo!2026"));
for (const [name, rows] of Object.entries(data))
  await collection(name).insertMany(rows);
const server = createApp().listen(4001, "127.0.0.1");
process.on("SIGTERM", () =>
  server.close(async () => {
    await closeDb();
    process.exit();
  }),
);
