import Database from 'better-sqlite3';
import { mkdirSync, readdirSync, readFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { config } from '../config.js';
import { logger } from '../logger.js';
const __dirname = dirname(fileURLToPath(import.meta.url));
mkdirSync(dirname(config.dbPath), { recursive: true });
export const db = new Database(config.dbPath);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');
function runMigrations() {
    db.exec(`
    CREATE TABLE IF NOT EXISTS _migrations (
      id TEXT PRIMARY KEY,
      applied_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);
    const migrationsDir = join(__dirname, 'migrations');
    if (!existsSync(migrationsDir)) {
        logger.warn({ migrationsDir }, 'Migrations directory not found, skipping');
        return;
    }
    const files = readdirSync(migrationsDir)
        .filter((f) => f.endsWith('.sql'))
        .sort();
    const applied = new Set(db
        .prepare('SELECT id FROM _migrations')
        .all()
        .map((row) => row.id));
    for (const file of files) {
        if (applied.has(file))
            continue;
        const sql = readFileSync(join(migrationsDir, file), 'utf-8');
        db.transaction(() => {
            db.exec(sql);
            db.prepare('INSERT INTO _migrations (id) VALUES (?)').run(file);
        })();
        logger.info({ migration: file }, 'Migration applied');
    }
}
runMigrations();
//# sourceMappingURL=client.js.map