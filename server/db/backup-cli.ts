import { readFile, writeFile, mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import { embedded } from "./database.js";
import { migrate } from "./migrate.js";
import { requireThat } from "../lib.js";
// Run with the API stopped. Snapshot files contain private financial links; keep them outside public exports.
const [action, path, target] = process.argv.slice(2);
requireThat(
  action === "backup" || action === "restore",
  "usage",
  "backup-cli.ts backup <data-dir> <snapshot-file> OR restore <snapshot-file> <NEW-data-dir>",
);
requireThat(path && target, "backup_paths_required");
if (action === "backup") {
  const db = embedded(resolve(path));
  try {
    await migrate(db);
    const snapshot = await db.backup();
    await writeFile(
      resolve(target),
      Buffer.from(await snapshot.arrayBuffer()),
      { flag: "wx" },
    );
    console.log("Embedded snapshot written; keep private");
  } finally {
    await db.close();
  }
} else {
  await mkdir(resolve(target), { recursive: false });
  const snapshot = new Blob([await readFile(resolve(path))]);
  const db = embedded(resolve(target), snapshot);
  try {
    await migrate(db);
    const count = (await db.query("SELECT count(*) AS count FROM rooms"))
      .rows[0].count;
    console.log(`Restored isolated database; rooms=${count}`);
  } finally {
    await db.close();
  }
}
