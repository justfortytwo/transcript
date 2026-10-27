import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openDb, type DbHandles } from '@justfortytwo/memory';
import { prepareTranscript } from '../src/db.js';
import type { TranscriptEvent } from '../src/types.js';

const fixtures: Array<{ root: string; h: DbHandles }> = [];

export async function fixture(opts: { prepare?: boolean } = {}): Promise<DbHandles> {
  const root = mkdtempSync(join(tmpdir(), 'transcript-'));
  const h = openDb(join(root, 'fortytwo.db'));
  fixtures.push({ root, h });
  if (opts.prepare !== false) await prepareTranscript(h);
  return h;
}

export async function cleanup(): Promise<void> {
  for (const { root, h } of fixtures.splice(0)) {
    await h.k.destroy();
    h.raw.close();
    rmSync(root, { recursive: true, force: true });
  }
}

export function event(content: string, over: Partial<TranscriptEvent> = {}): TranscriptEvent {
  return { channel: 'telegram', direction: 'inbound', actor: 'owner', kind: 'message', content, ...over };
}

export function vecCount(h: DbHandles): number {
  return (h.raw.prepare('SELECT count(*) AS n FROM transcript_vec').get() as { n: number }).n;
}

export function hasVec(h: DbHandles, id: number): boolean {
  return h.raw.prepare('SELECT 1 FROM transcript_vec WHERE rowid = ?').get(BigInt(id)) !== undefined;
}

/** Poll until `cond` holds; background embedding has no completion handle. */
export async function until(cond: () => boolean, ms = 2000): Promise<void> {
  const end = Date.now() + ms;
  while (!cond()) {
    if (Date.now() > end) throw new Error('condition not met in time');
    await new Promise((r) => setTimeout(r, 5));
  }
}
