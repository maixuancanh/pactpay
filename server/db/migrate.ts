import { readFile, readdir } from "node:fs/promises";
import type { Database } from "./database.js";
export async function migrate(db: Database) {
  await db.exec(
    "CREATE TABLE IF NOT EXISTS schema_migrations (name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())",
  );
  for (const name of (await readdir(new URL("./migrations/", import.meta.url)))
    .filter((x) => x.endsWith(".sql"))
    .sort()) {
    await db.transaction(async (tx) => {
      // database-wide migration lock across hosts
      await tx.query("LOCK TABLE schema_migrations IN EXCLUSIVE MODE");
      if (
        (
          await tx.query("SELECT name FROM schema_migrations WHERE name=$1", [
            name,
          ])
        ).rows.length
      )
        return;
      const sql = await readFile(
        new URL(`./migrations/${name}`, import.meta.url),
        "utf8",
      );
      // Migrations are trusted repo SQL. PGlite query rejects multiple statements.
      for (const statement of sql
        .split(";")
        .map((x) => x.trim())
        .filter(Boolean))
        await tx.query(statement);
      await tx.query("INSERT INTO schema_migrations(name) VALUES($1)", [name]);
    });
  }
}
