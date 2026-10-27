import { applyMigrations, EMBED_DIM, type DbHandles, type Migration } from '@justfortytwo/memory';
import * as m001 from './migrations/001_init.js';
import * as m002 from './migrations/002_fts.js';
import * as m003 from './migrations/003_identity.js';

// Recorded in memory's `_migration_state`; the `transcript_` prefix keeps the
// names apart from memory's own list.
export const TRANSCRIPT_MIGRATIONS: Migration[] = [
  { name: 'transcript_001_init', up: m001.up, down: m001.down },
  { name: 'transcript_002_fts', up: m002.up, down: m002.down },
  { name: 'transcript_003_identity', up: m003.up, down: m003.down },
];

/**
 * Create transcript's schema in the shared DB. Idempotent and safe under
 * concurrent first-open, like memory's openDb + runMigrations.
 */
export async function prepareTranscript(h: DbHandles): Promise<void> {
  // vec0 lives on the raw handle (sqlite-vec is loaded only there). BEGIN
  // IMMEDIATE takes the write lock before the existence check.
  h.raw.transaction(() => {
    h.raw.exec(`CREATE VIRTUAL TABLE IF NOT EXISTS transcript_vec USING vec0(embedding float[${EMBED_DIM}])`);
  }).immediate();
  await applyMigrations(h.k, TRANSCRIPT_MIGRATIONS);
}
