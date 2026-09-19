import { closeDb } from "../apps/api/src/db.js";
import { refreshDemoCatalog } from "../apps/api/src/refresh-demo-catalog.js";

try {
  console.log(JSON.stringify(await refreshDemoCatalog(), null, 2));
} finally {
  await closeDb();
}
