import { afterEach, expect, it, vi } from 'vitest';
import { FakeEmbedder, type Embedder } from '@justfortytwo/memory';
import { prepareTranscript } from '../src/db.js';
import { createTranscript } from '../src/transcript.js';
import type { TranscriptRow } from '../src/types.js';
import { cleanup, event, fixture, until, vecCount } from './helpers.js';

afterEach(async () => { vi.restoreAllMocks(); await cleanup(); });

it('returns an id and the row is readable at once', async () => {
  const h = await fixture();
  const t = createTranscript(h, new FakeEmbedder());
  const id = await t.append(event('hello there', { threadId: '42', meta: { message_id: 7 } }));
  const row = h.raw.prepare('SELECT * FROM transcript WHERE id = ?').get(id) as TranscriptRow;
  expect(row).toMatchObject({
    id, channel: 'telegram', direction: 'inbound', actor: 'owner', kind: 'message',
    thread_id: '42', content: 'hello there', legacy_memory_id: null,
  });
  expect(JSON.parse(row.meta)).toEqual({ message_id: 7 });
  expect(row.ts).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/);
  await until(() => vecCount(h) === 1);
});

it('indexes content for FTS', async () => {
  const h = await fixture();
  const t = createTranscript(h, new FakeEmbedder());
  const id = await t.append(event('the SIPEF hours cap'));
  await t.append(event('unrelated chatter'));
  const hits = h.raw.prepare('SELECT rowid FROM transcript_fts WHERE transcript_fts MATCH ?').all('sipef') as Array<{ rowid: number }>;
  expect(hits.map((r) => r.rowid)).toEqual([id]);
  await until(() => vecCount(h) === 2);
});

it('resolves before the vector exists when the embedder is slow', async () => {
  const h = await fixture();
  let release!: () => void;
  const gate = new Promise<void>((r) => { release = r; });
  const fake = new FakeEmbedder();
  const slow: Embedder = { embed: async (text) => { await gate; return fake.embed(text); } };
  const t = createTranscript(h, slow);
  await t.append(event('slow one'));
  expect(vecCount(h)).toBe(0);
  release();
  await until(() => vecCount(h) === 1);
});

it('does not reject when the embedder throws, and logs to stderr', async () => {
  const h = await fixture();
  const err = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
  const t = createTranscript(h, { embed: async () => { throw new Error('ollama down'); } });
  const id = await t.append(event('still stored'));
  expect(id).toBeGreaterThan(0);
  await until(() => err.mock.calls.some(([s]) => String(s).includes('ollama down')));
  expect(vecCount(h)).toBe(0);
});

it('prepareTranscript is idempotent', async () => {
  const h = await fixture();
  await prepareTranscript(h);
  const objects = h.raw.prepare(
    "SELECT type, name FROM sqlite_master WHERE name LIKE 'transcript%' AND type IN ('table','index','trigger') ORDER BY name",
  ).all() as Array<{ name: string }>;
  const names = objects.map((o) => o.name);
  expect(new Set(names).size).toBe(names.length);
  expect(names).toEqual(expect.arrayContaining(['transcript', 'transcript_fts', 'transcript_vec', 'transcript_identity', 'transcript_ai', 'transcript_ad', 'transcript_au']));
  const state = h.raw.prepare("SELECT name FROM _migration_state WHERE name LIKE 'transcript_%' ORDER BY name").all() as Array<{ name: string }>;
  expect(state.map((s) => s.name)).toEqual(['transcript_001_init', 'transcript_002_fts', 'transcript_003_identity']);
  const ids = h.raw.prepare('SELECT count(*) AS n FROM transcript_identity').get() as { n: number };
  expect(ids.n).toBe(1);
});
