import { afterEach, expect, it, vi } from 'vitest';
import { FakeEmbedder } from '@justfortytwo/memory';
import { createTranscript } from '../src/transcript.js';
import { cleanup, event, fixture, until, vecCount } from './helpers.js';

afterEach(async () => { vi.restoreAllMocks(); await cleanup(); });

async function seeded(rows: Array<[string, Parameters<typeof event>[1]?]>) {
  const h = await fixture();
  const t = createTranscript(h, new FakeEmbedder());
  const ids: number[] = [];
  for (const [c, o] of rows) ids.push(await t.append(event(c, o)));
  await until(() => vecCount(h) === rows.length);
  return { h, t, ids };
}

it('finds an exact word by keyword', async () => {
  const { t, ids } = await seeded([['the invoice is overdue'], ['lunch plans for friday']]);
  const hits = await t.search({ text: 'invoice' });
  const hit = hits.find((x) => x.id === ids[0])!;
  expect(hit.matched).toContain('keyword');
  expect(hits.find((x) => x.id === ids[1])?.matched).not.toContain('keyword');
});

it('returns a vector-only row as semantic', async () => {
  const { t, ids } = await seeded([['the invoice is overdue'], ['lunch plans for friday']]);
  const hit = (await t.search({ text: 'invoice' })).find((x) => x.id === ids[1])!;
  expect(hit.matched).toEqual(['semantic']);
});

it('ranks a row found by both legs above rows found by one', async () => {
  const { t, ids } = await seeded([['alpha one'], ['alpha beta'], ['gamma delta']]);
  const hits = await t.search({ text: 'alpha beta' });
  expect(hits[0].id).toBe(ids[1]);
  expect(hits[0].matched).toEqual(['keyword', 'semantic']);
  expect(hits[0].score).toBeGreaterThan(hits[1].score);
});

it('still finds rows that have no vector yet by keyword', async () => {
  vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
  const h = await fixture();
  const t = createTranscript(h, { embed: async () => { throw new Error('down'); } });
  const id = await t.append(event('pending vector word'));
  await new Promise((r) => setTimeout(r, 20));
  const hits = await t.search({ text: 'pending' });
  expect(hits.map((x) => x.id)).toEqual([id]);
  expect(hits[0].matched).toEqual(['keyword']);
});

it('filters by since, until, channel and threadId', async () => {
  const h = await fixture();
  const t = createTranscript(h, new FakeEmbedder());
  const a = t.importRow({ ...event('shared word a'), ts: '2026-01-01 10:00:00', legacyMemoryId: 1 });
  const b = t.importRow({ ...event('shared word b', { channel: 'email', threadId: 'T1' }), ts: '2026-02-01 10:00:00', legacyMemoryId: 2 });
  const c = t.importRow({ ...event('shared word c'), ts: '2026-03-01 10:00:00', legacyMemoryId: 3 });
  const ids = async (o: object) => (await t.search({ text: 'shared', ...o })).map((x) => x.id).sort();
  expect(await ids({ since: '2026-02-01 00:00:00' })).toEqual([b, c]);
  expect(await ids({ until: '2026-02-01 23:59:59' })).toEqual([a, b]);
  expect(await ids({ channel: 'email' })).toEqual([b]);
  expect(await ids({ threadId: 'T1' })).toEqual([b]);
});

it('returns [] for empty or blank text', async () => {
  const { t } = await seeded([['anything']]);
  expect(await t.search({ text: '' })).toEqual([]);
  expect(await t.search({ text: '   ' })).toEqual([]);
});

it('never throws on FTS operator or quote text', async () => {
  const { t } = await seeded([['foo bar']]);
  for (const text of ['"foo* AND NEAR(', '"', '""', '*', 'a OR', '(', 'col:foo', '-foo']) {
    await expect(t.search({ text })).resolves.toBeInstanceOf(Array);
  }
});

it('clamps limit to 50 and at least 1', async () => {
  const h = await fixture();
  const t = createTranscript(h, new FakeEmbedder());
  for (let i = 0; i < 60; i++) t.importRow({ ...event(`common ${i}`), ts: '2026-01-01 00:00:00', legacyMemoryId: i + 1 });
  expect((await t.search({ text: 'common', limit: 500 })).length).toBe(50);
  expect((await t.search({ text: 'common', limit: 0 })).length).toBe(1);
  expect((await t.search({ text: 'common' })).length).toBe(10);
});

it('finds a semantic match under a filter even with a row that has no keyword hit', async () => {
  const { t, ids } = await seeded([
    ['the invoice is overdue', { channel: 'email' }],
    ['lunch plans for friday', { channel: 'email' }],
    ['lunch plans for friday', { channel: 'telegram' }],
  ]);
  const hits = await t.search({ text: 'invoice', channel: 'email' });
  expect(hits.map((x) => x.id).sort()).toEqual([ids[0], ids[1]]);
  expect(hits.find((x) => x.id === ids[1])!.matched).toEqual(['semantic']);
  const byThread = await seeded([['x1', { threadId: 'T' }], ['y', { threadId: 'U' }]]);
  expect((await byThread.t.search({ text: 'zzz', threadId: 'T' })).map((x) => x.matched)).toEqual([['semantic']]);
});

it('finds a narrow-filter semantic match in a corpus larger than the candidate window', async () => {
  const h = await fixture();
  const e = new FakeEmbedder();
  const t = createTranscript(h, e);
  for (let i = 0; i < 250; i++) await t.append(event(`filler ${i}`, { threadId: 'noise' }));
  const target = await t.append(event('needle row', { threadId: 'narrow' }));
  await until(() => vecCount(h) === 251, 10000);
  const hits = await t.search({ text: 'unrelated query', threadId: 'narrow' });
  expect(hits).toHaveLength(1);
  expect(hits[0].id).toBe(target);
  expect(hits[0].matched).toEqual(['semantic']);
});

it('does not throw on NUL bytes in the query', async () => {
  const { t, ids } = await seeded([['alpha beta'], ['gamma']]);
  expect(await t.search({ text: '\u0000' })).toEqual([]);
  const hits = await t.search({ text: 'alpha\u0000beta' });
  expect(hits.map((x) => x.id)).toContain(ids[0]);
});
