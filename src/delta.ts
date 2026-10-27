// Insertion cursor for evidence consumers (persona's oneiros). Same semantics
// as memory's delta.ts: database identity plus an AUTOINCREMENT watermark.
import type { DbHandles } from '@justfortytwo/memory';
import type { Cursor, TranscriptRow } from './types.js';

export function transcriptHead(h: DbHandles): Cursor {
  const identity = h.raw.prepare('SELECT identity FROM transcript_identity WHERE id=1').get() as { identity: string } | undefined;
  if (!identity) throw new Error('Transcript identity missing; run prepareTranscript');
  // AUTOINCREMENT high watermark survives deletion of the newest/all rows.
  const sequence = h.raw.prepare("SELECT seq FROM sqlite_sequence WHERE name='transcript'").get() as { seq: number } | undefined;
  return { database: identity.identity, position: sequence?.seq ?? 0 };
}

export function transcriptDelta(h: DbHandles, cursor: Cursor, limit = 50): { cursor: Cursor; entries: TranscriptRow[] } {
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 200) throw new Error('Invalid delta limit');
  return h.raw.transaction(() => {
    const head = transcriptHead(h);
    if (cursor.database !== head.database || !Number.isSafeInteger(cursor.position) || cursor.position < 0 || cursor.position > head.position) throw new Error('Invalid transcript database cursor');
    const rows = h.raw.prepare('SELECT * FROM transcript WHERE id > ? AND id <= ? ORDER BY id ASC LIMIT ?').all(cursor.position, head.position, limit + 1) as TranscriptRow[];
    const more = rows.length > limit;
    const entries = rows.slice(0, limit);
    return { entries, cursor: { database: head.database, position: more ? entries[entries.length - 1]!.id : head.position } };
  })();
}
