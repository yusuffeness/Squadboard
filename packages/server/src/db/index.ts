import Database from 'better-sqlite3';
import { drizzle, type BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { mkdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as schema from './schema.js';

export { schema };
export type Db = BetterSQLite3Database<typeof schema>;

export interface DbHandle {
  db: Db;
  /** Raw better-sqlite3 connection (pragmas, ad-hoc queries in tests). */
  sqlite: Database.Database;
  /** Path of the SQLite file, or ':memory:'. */
  path: string;
  close(): void;
}

/** `~/.squadboard/squadboard.db`, overridable with SQUADBOARD_DB. */
export function defaultDbPath(): string {
  return process.env.SQUADBOARD_DB ?? join(homedir(), '.squadboard', 'squadboard.db');
}

// Both src/db and dist/db sit two levels below the package root.
const MIGRATIONS_DIR = fileURLToPath(new URL('../../drizzle', import.meta.url));

/** Opens (and creates) the database and applies pending migrations. */
export function openDatabase(path: string = defaultDbPath()): DbHandle {
  if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
  const sqlite = new Database(path);
  sqlite.pragma('journal_mode = WAL');
  sqlite.pragma('foreign_keys = ON');
  sqlite.pragma('busy_timeout = 5000');
  const db = drizzle({ client: sqlite, schema });
  migrate(db, { migrationsFolder: MIGRATIONS_DIR });
  return { db, sqlite, path, close: () => sqlite.close() };
}
