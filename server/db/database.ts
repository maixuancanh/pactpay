import { Pool } from "pg";
import { PGlite } from "@electric-sql/pglite";
export type Row = Record<string, any>;
export interface Sql {
  query<T extends Row = Row>(
    sql: string,
    params?: unknown[],
  ): Promise<{ rows: T[] }>;
}
export interface Database extends Sql {
  transaction<T>(body: (sql: Sql) => Promise<T>): Promise<T>;
  exec(sql: string): Promise<void>;
  close(): Promise<void>;
}
export function postgres(url: string, schema?: string): Database {
  if (schema && !/^[a-z][a-z0-9_]+$/.test(schema))
    throw Error("Invalid isolated schema");
  const pool = new Pool({
    connectionString: url,
    max: 10,
    ...(schema ? { options: `-c search_path=${schema}` } : {}),
  });
  return {
    query: async (s, p) => pool.query(s, p),
    exec: async (s) => {
      await pool.query(s);
    },
    transaction: async (body) => {
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        const result = await body(client);
        await client.query("COMMIT");
        return result;
      } catch (e) {
        await client.query("ROLLBACK");
        throw e;
      } finally {
        client.release();
      }
    },
    close: async () => {
      await pool.end();
    },
  };
}
export interface EmbeddedDatabase extends Database {
  backup(): Promise<Blob>;
}
export function embedded(path?: string, snapshot?: Blob): EmbeddedDatabase {
  const pg = path
    ? new PGlite(path, { loadDataDir: snapshot })
    : new PGlite({ loadDataDir: snapshot });
  let queue = Promise.resolve();
  // Single connection local database: serialize whole transactions, not individual statements.
  const run = <T>(body: () => Promise<T>): Promise<T> => {
    const result = queue.then(body);
    queue = result.then(
      () => {},
      () => {},
    );
    return result;
  };
  return {
    query: (s, p) => run(() => pg.query(s, p)),
    exec: (s) =>
      run(async () => {
        await pg.exec(s);
      }),
    backup: () => run(() => pg.dumpDataDir()),
    transaction: (body) =>
      run(() =>
        pg.transaction((tx) => body({ query: (s, p) => tx.query(s, p) })),
      ),
    close: () => run(() => pg.close()),
  };
}
