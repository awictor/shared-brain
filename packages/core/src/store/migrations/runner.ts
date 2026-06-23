import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import type Database from 'better-sqlite3';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

/**
 * Simple migration runner that reads .sql files from the migrations directory
 * and applies them in order. Tracks applied migrations in a `_migrations` table.
 */
export class MigrationRunner {
  private db: Database.Database;
  private migrationsDir: string;

  constructor(db: Database.Database, migrationsDir?: string) {
    this.db = db;
    this.migrationsDir = migrationsDir ?? __dirname;
  }

  /**
   * Run all pending migrations.
   * Creates the _migrations tracking table if it doesn't exist.
   */
  run(): void {
    // Create migrations tracking table
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS _migrations (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL UNIQUE,
        applied_at TEXT NOT NULL
      );
    `);

    // Get already-applied migrations
    const applied = new Set(
      this.db
        .prepare('SELECT name FROM _migrations ORDER BY id')
        .all()
        .map((row: any) => row.name as string)
    );

    // Find all .sql files in the migrations directory
    const files = readdirSync(this.migrationsDir)
      .filter((f) => f.endsWith('.sql'))
      .sort(); // Lexicographic sort ensures order: 001_, 002_, etc.

    // Apply each pending migration in a transaction
    for (const file of files) {
      if (applied.has(file)) continue;

      const sql = readFileSync(join(this.migrationsDir, file), 'utf-8');

      const transaction = this.db.transaction(() => {
        // Execute the migration SQL
        this.db.exec(sql);

        // Record it as applied
        this.db.prepare('INSERT INTO _migrations (name, applied_at) VALUES (?, ?)').run(
          file,
          new Date().toISOString()
        );
      });

      transaction();
    }
  }

  /**
   * Get list of applied migrations.
   */
  getApplied(): Array<{ name: string; appliedAt: string }> {
    return this.db
      .prepare('SELECT name, applied_at as appliedAt FROM _migrations ORDER BY id')
      .all() as Array<{ name: string; appliedAt: string }>;
  }

  /**
   * Get list of pending (unapplied) migrations.
   */
  getPending(): string[] {
    const applied = new Set(
      this.db
        .prepare('SELECT name FROM _migrations ORDER BY id')
        .all()
        .map((row: any) => row.name as string)
    );

    return readdirSync(this.migrationsDir)
      .filter((f) => f.endsWith('.sql'))
      .sort()
      .filter((f) => !applied.has(f));
  }
}
