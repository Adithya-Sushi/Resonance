import { initDb, initGraph, closeDb } from "./db.js";
try {
  await initDb();
  await initGraph();
  console.log("MongoDB validators/indexes and Neo4j constraints ready.");
} finally {
  await closeDb();
}
