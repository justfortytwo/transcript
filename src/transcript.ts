import type { DbHandles, Embedder } from '@justfortytwo/memory';
import { vecToBuffer } from '@justfortytwo/memory';
import type { ImportRow, Transcript, TranscriptEvent } from './types.js';

/** Sweep attempts per row before the sweep stops retrying it (per Transcript instance). */
const MAX_SWEEP_ATTEMPTS = 3;
const SWEEP_PAGE = 100;

function log(msg: string): void {
  process.stderr.write(`transcript: ${msg}\n`);
}

function errMsg(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

export function createTranscript(h: DbHandles, embedder: Embedder): Transcript {
  const insRow = h.raw.prepare(
    `INSERT INTO transcript (channel, direction, actor, kind, thread_id, content, meta)
     VALUES (@channel, @direction, @actor, @kind, @thread_id, @content, @meta)`,
  );
  const insImported = h.raw.prepare(
    `INSERT INTO transcript (ts, channel, direction, actor, kind, thread_id, content, meta, legacy_memory_id)
     VALUES (@ts, @channel, @direction, @actor, @kind, @thread_id, @content, @meta, @legacy_memory_id)`,
  );
  const byLegacy = h.raw.prepare('SELECT id FROM transcript WHERE legacy_memory_id = ?');
  const vecExists = h.raw.prepare('SELECT 1 FROM transcript_vec WHERE rowid = ?');
  const insVec = h.raw.prepare('INSERT INTO transcript_vec (rowid, embedding) VALUES (?, ?)');
  const missing = h.raw.prepare(
    `SELECT id, content FROM transcript t
     WHERE t.id > ? AND NOT EXISTS (SELECT 1 FROM transcript_vec v WHERE v.rowid = t.id)
     ORDER BY t.id ASC LIMIT ?`,
  );

  // Rows being embedded right now (by append or a sweep), so the two never race on one rowid.
  const inFlight = new Set<number>();
  // Sweep failures per row id, held in process memory only.
  const failures = new Map<number, number>();

  // vec0 accepts only a 64-bit INTEGER rowid binding: bind as BigInt (as memory does).
  const writeVec = h.raw.transaction((id: number, buf: Buffer) => {
    if (vecExists.get(BigInt(id)) === undefined) insVec.run(BigInt(id), buf);
  });

  async function embedRow(id: number, content: string): Promise<void> {
    inFlight.add(id);
    try {
      writeVec(id, vecToBuffer(await embedder.embed(content)));
    } finally {
      inFlight.delete(id);
    }
  }

  function fields(e: TranscriptEvent) {
    return {
      channel: e.channel,
      direction: e.direction,
      actor: e.actor,
      kind: e.kind,
      thread_id: e.threadId ?? null,
      content: e.content,
      meta: JSON.stringify(e.meta ?? {}),
    };
  }

  return {
    async append(e) {
      const id = Number(insRow.run(fields(e)).lastInsertRowid);
      // Never awaited: a slow or failing embedder must not delay or fail the caller.
      void embedRow(id, e.content).catch((err) => log(`embedding row ${id} failed: ${errMsg(err)}`));
      return id;
    },

    importRow: h.raw.transaction((r: ImportRow): number => {
      const existing = byLegacy.get(r.legacyMemoryId) as { id: number } | undefined;
      if (existing) return existing.id;
      const id = Number(insImported.run({ ...fields(r), ts: r.ts, legacy_memory_id: r.legacyMemoryId }).lastInsertRowid);
      if (r.embedding) writeVec(id, r.embedding);
      return id;
    }),

    // `batch` bounds embedder calls per sweep; returns how many vectors were written.
    async sweepMissingVectors(batch = 100) {
      if (!Number.isSafeInteger(batch) || batch < 1) throw new Error('Invalid sweep batch');
      let attempts = 0;
      let embedded = 0;
      let after = 0;
      while (attempts < batch) {
        const rows = missing.all(after, SWEEP_PAGE) as Array<{ id: number; content: string }>;
        if (rows.length === 0) break;
        for (const row of rows) {
          after = row.id;
          if (inFlight.has(row.id) || (failures.get(row.id) ?? 0) >= MAX_SWEEP_ATTEMPTS) continue;
          attempts++;
          try {
            await embedRow(row.id, row.content);
            failures.delete(row.id);
            embedded++;
          } catch (err) {
            const n = (failures.get(row.id) ?? 0) + 1;
            failures.set(row.id, n);
            log(`sweep: embedding row ${row.id} failed (attempt ${n}/${MAX_SWEEP_ATTEMPTS}): ${errMsg(err)}`);
          }
          if (attempts >= batch) break;
        }
      }
      return embedded;
    },
  };
}
