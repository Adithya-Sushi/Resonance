import dotenv from "dotenv";
import { fileURLToPath } from "node:url";
dotenv.config({
  path: fileURLToPath(new URL("../../../.env", import.meta.url)),
  quiet: true,
});
export const config = {
  port: Number(process.env.PORT || 4000),
  origin: process.env.APP_ORIGIN || "http://localhost:5173",
  mongoUrl:
    process.env.MONGO_URL ||
    "mongodb://127.0.0.1:27017/?replicaSet=rs0&directConnection=true",
  db: process.env.MONGO_DB || "resonance",
  neoUri: process.env.NEO4J_URI || "bolt://127.0.0.1:7687",
  neoUser: process.env.NEO4J_USER || "neo4j",
  neoPassword: process.env.NEO4J_PASSWORD || "resonance-local-password",
  secret:
    process.env.SESSION_SECRET || "local-development-only-change-before-deploy",
  youtubeKey: process.env.YOUTUBE_API_KEY || "",
  production: process.env.NODE_ENV === "production",
};
