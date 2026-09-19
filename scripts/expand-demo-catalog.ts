import { closeDb } from "../apps/api/src/db.js";
import { expandDemoCatalog } from "../apps/api/src/expand-demo-catalog.js";
try {
  console.log(JSON.stringify(await expandDemoCatalog(), null, 2));
} finally {
  await closeDb();
}
