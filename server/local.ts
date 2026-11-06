import { embedded } from "./db/database.js";
import { start } from "./app.js";
import { fileURLToPath } from "node:url";
await start(
  embedded(fileURLToPath(new URL("./.local-data/", import.meta.url))),
  true,
);
