import { afterEach, expect, it } from 'vitest';
import { FakeEmbedder } from '@justfortytwo/memory';
import { createTranscript } from '../src/transcript.js';
import { transcriptDelta, transcriptHead } from '../src/delta.js';
import { cleanup, event, fixture, until, vecCount } from './helpers.js';

afterEach(cleanup);

async function seeded(n: number) {
  const h = await fixture();
  const t = createTranscript(h, new FakeEmbedder());
  const ids: number[] = [];
  for (let i = 0; i < n; i++) ids.push(await t.append(event(`message ${i}`)));
  await until(() => vecCount(h) === n);
  return { h, ids };
}

it('head position equals the highest id', async () => {
  const { h, ids } = await seeded(3);
  expect(transcriptHead(h).position).toBe(ids[2]);
});

it('returns rows after the cursor in id order with the next cursor', async () => {
  const h = await fixture();
  const start = transcriptHead(h);
  expect(start.position).toBe(0);
  const t = createTranscript(h, new FakeEmbedder());
  const ids: number[] = [];
  for (let i = 0; i < 5; i++) ids.push(await t.append(event(`m${i}`)));
  await until(() => vecCount(h) === 5);
  const a = transcriptDelta(h, start, 2);
  expect(a.entries.map((r) => r.id)).toEqual(ids.slice(0, 2));
  expect(a.cursor).toEqual({ database: start.database, position: ids[1] });
  const b = transcriptDelta(h, a.cursor, 10);
  expect(b.entries.map((r) => r.id)).toEqual(ids.slice(2));
  expect(b.cursor.position).toBe(ids[4]);
  expect(transcriptDelta(h, b.cursor).entries).toEqual([]);
});

it('rejects a cursor from another database or beyond head', async () => {
  const { h } = await seeded(2);
  const other = await fixture();
  const head = transcriptHead(h);
  expect(() => transcriptDelta(other, head)).toThrow('Invalid transcript database cursor');
  expect(() => transcriptDelta(h, { ...head, position: head.position + 1 })).toThrow('Invalid transcript database cursor');
  expect(() => transcriptDelta(h, head, 0)).toThrow('Invalid delta limit');
});

it('head survives deleting the newest row', async () => {
  const { h, ids } = await seeded(3);
  h.raw.prepare('DELETE FROM transcript WHERE id = ?').run(ids[2]);
  expect(transcriptHead(h).position).toBe(ids[2]);
});
