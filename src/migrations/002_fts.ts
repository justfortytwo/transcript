import type { Migration } from '@justfortytwo/memory';

type Knex = Parameters<Migration['up']>[0];

// Same shape as memory's 002_fts: external-content FTS5 kept in sync by triggers.
export async function up(k: Knex): Promise<void> {
  if (k.client.config.client !== 'better-sqlite3') return;
  await k.raw(`CREATE VIRTUAL TABLE IF NOT EXISTS transcript_fts USING fts5(content, content='transcript', content_rowid='id')`);
  await k.raw(`CREATE TRIGGER IF NOT EXISTS transcript_ai AFTER INSERT ON transcript BEGIN
    INSERT INTO transcript_fts(rowid, content) VALUES (new.id, new.content);
  END`);
  await k.raw(`CREATE TRIGGER IF NOT EXISTS transcript_ad AFTER DELETE ON transcript BEGIN
    INSERT INTO transcript_fts(transcript_fts, rowid, content) VALUES('delete', old.id, old.content);
  END`);
  await k.raw(`CREATE TRIGGER IF NOT EXISTS transcript_au AFTER UPDATE ON transcript BEGIN
    INSERT INTO transcript_fts(transcript_fts, rowid, content) VALUES('delete', old.id, old.content);
    INSERT INTO transcript_fts(rowid, content) VALUES (new.id, new.content);
  END`);
}

export async function down(k: Knex): Promise<void> {
  if (k.client.config.client !== 'better-sqlite3') return;
  await k.raw('DROP TRIGGER IF EXISTS transcript_au');
  await k.raw('DROP TRIGGER IF EXISTS transcript_ad');
  await k.raw('DROP TRIGGER IF EXISTS transcript_ai');
  await k.raw('DROP TABLE IF EXISTS transcript_fts');
}
