import { createApp } from "./app.js";
import { config } from "./config.js";
import { mongo, initDb, closeDb } from "./db.js";
await mongo.connect();
await initDb();
const server = createApp().listen(config.port, () =>
  console.log(`Resonance API http://localhost:${config.port}`),
);
for (const signal of ["SIGINT", "SIGTERM"])
  process.on(signal, () =>
    server.close(async () => {
      await closeDb();
      process.exit(0);
    }),
  );
