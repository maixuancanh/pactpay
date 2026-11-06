import { postgres } from "./database.js";
import { migrate } from "./migrate.js";
if (!process.env.DATABASE_URL) throw Error("DATABASE_URL required");
const db = postgres(process.env.DATABASE_URL);
try {
  await migrate(db);
  console.log("Migrations applied");
} finally {
  await db.close();
}
