import { afterEach, expect, it, vi } from 'vitest';
import { FakeEmbedder, vecToBuffer, type Embedder } from '@justfortytwo/memory';
import { createTranscript } from '../src/transcript.js';
import { cleanup, event, fixture, hasVec, until, vecCount } from './helpers.js';

afterEach(async () => { vi.restoreAllMocks(); await cleanup(); });

const fake = new FakeEmbedder();

/** Embedder that fails until `ok` is set, so rows can be appended without vectors. */
function switchable() {
  const s = { ok: false, calls: [] as string[] };
  const e: Embedder = {
    embed: async (text) => {
      s.calls.push(text);
      if (!s.ok || text === 'poison') throw new Error(`cannot embed ${text}`);
      return fake.embed(text);
    },
  };
  return { s, e };
}

async function settle(): Promise<void> {
  await new Promise((r) => setTimeout(r, 20));
}

it('fills missing vectors', async () => {
  const h = await fixture();
  vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
  const { s, e } = switchable();
  const t = createTranscript(h, e);
  await t.append(event('one'));
  await t.append(event('two'));
  await settle();
  expect(vecCount(h)).toBe(0);
  s.ok = true;
  expect(await t.sweepMissingVectors()).toBe(2);
  expect(vecCount(h)).toBe(2);
  expect(await t.sweepMissingVectors()).toBe(0);
});

it('skips a row after 3 failed attempts and still embeds later rows', async () => {
  const h = await fixture();
  vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
  const { s, e } = switchable();
  const t = createTranscript(h, e);
  const poison = await t.append(event('poison'));
  const later = await t.append(event('later'));
  await settle();
  s.ok = true;
  s.calls.length = 0;

  // The append attempt is not a sweep attempt; each sweep call tries poison once.
  expect(await t.sweepMissingVectors()).toBe(1);
  expect(hasVec(h, later)).toBe(true);
  expect(await t.sweepMissingVectors()).toBe(0);
  expect(await t.sweepMissingVectors()).toBe(0);
  expect(s.calls.filter((c) => c === 'poison')).toHaveLength(3);

  const after = await t.append(event('after'));
  await until(() => hasVec(h, after));
  s.calls.length = 0;
  expect(await t.sweepMissingVectors()).toBe(0);
  expect(s.calls).toEqual([]);
  expect(hasVec(h, poison)).toBe(false);
});

it('respects the batch size', async () => {
  const h = await fixture();
  vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
  const { s, e } = switchable();
  const t = createTranscript(h, e);
  for (const c of ['a', 'b', 'c']) await t.append(event(c));
  await settle();
  s.ok = true;
  expect(await t.sweepMissingVectors(2)).toBe(2);
  expect(await t.sweepMissingVectors(2)).toBe(1);
});

it('importRow stores a given embedding and the sweep leaves it alone', async () => {
  const h = await fixture();
  const calls: string[] = [];
  const t = createTranscript(h, { embed: async (x) => { calls.push(x); return fake.embed(x); } });
  const embedding = vecToBuffer(await fake.embed('imported'));
  const id = t.importRow({
    ...event('imported', { threadId: '9', meta: { a: 1 } }),
    ts: '2026-01-02 03:04:05', legacyMemoryId: 17, embedding,
  });
  const row = h.raw.prepare('SELECT ts, thread_id, meta, legacy_memory_id FROM transcript WHERE id = ?').get(id);
  expect(row).toEqual({ ts: '2026-01-02 03:04:05', thread_id: '9', meta: '{"a":1}', legacy_memory_id: 17 });
  expect(hasVec(h, id)).toBe(true);
  expect(await t.sweepMissingVectors()).toBe(0);
  expect(calls).toEqual([]);
});

it('importRow without an embedding leaves the vector to the sweep', async () => {
  const h = await fixture();
  const t = createTranscript(h, fake);
  const id = t.importRow({ ...event('no vec'), ts: '2026-01-02 03:04:05', legacyMemoryId: 3 });
  expect(hasVec(h, id)).toBe(false);
  expect(await t.sweepMissingVectors()).toBe(1);
  expect(hasVec(h, id)).toBe(true);
});

it('importRow is idempotent on legacyMemoryId', async () => {
  const h = await fixture();
  const t = createTranscript(h, fake);
  const r = { ...event('dup'), ts: '2026-01-02 03:04:05', legacyMemoryId: 5 };
  const first = t.importRow(r);
  const second = t.importRow({ ...r, content: 'changed' });
  expect(second).toBe(first);
  const n = h.raw.prepare('SELECT count(*) AS n FROM transcript').get() as { n: number };
  expect(n.n).toBe(1);
});
