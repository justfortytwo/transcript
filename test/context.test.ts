import { afterEach, expect, it } from 'vitest';
import { FakeEmbedder } from '@justfortytwo/memory';
import { createTranscript } from '../src/transcript.js';
import { cleanup, event, fixture } from './helpers.js';

afterEach(cleanup);

async function setup() {
  const h = await fixture();
  const t = createTranscript(h, new FakeEmbedder());
  return t;
}

it('stays inside the thread when the hit has one', async () => {
  const t = await setup();
  const a1 = await t.append(event('a1', { threadId: 'A' }));
  await t.append(event('b1', { threadId: 'B' }));
  const a2 = await t.append(event('a2', { threadId: 'A' }));
  await t.append(event('n1'));
  const a3 = await t.append(event('a3', { threadId: 'A' }));
  expect((t.context(a2, 5, 5)).map((r) => r.id)).toEqual([a1, a2, a3]);
});

it('falls back to same-channel neighbours for a null thread', async () => {
  const t = await setup();
  const x1 = await t.append(event('x1', { channel: 'email' }));
  await t.append(event('t1', { channel: 'telegram' }));
  const x2 = await t.append(event('x2', { channel: 'email' }));
  const x3 = await t.append(event('x3', { channel: 'email', threadId: 'Z' }));
  expect(t.context(x2).map((r) => r.id)).toEqual([x1, x2, x3]);
});

it('returns fewer rows at the first and last row of a channel', async () => {
  const t = await setup();
  const ids: number[] = [];
  for (let i = 0; i < 4; i++) ids.push(await t.append(event(`m${i}`)));
  expect(t.context(ids[0], 3, 1).map((r) => r.id)).toEqual([ids[0], ids[1]]);
  expect(t.context(ids[3], 1, 3).map((r) => r.id)).toEqual([ids[2], ids[3]]);
});

it('honours before/after and clamps to 20', async () => {
  const t = await setup();
  const ids: number[] = [];
  for (let i = 0; i < 60; i++) ids.push(await t.append(event(`m${i}`)));
  expect(t.context(ids[30], 2, 1).map((r) => r.id)).toEqual(ids.slice(28, 32));
  expect(t.context(ids[30], 9999, 9999).length).toBe(41);
  expect(t.context(ids[30], -5, -5).map((r) => r.id)).toEqual([ids[30]]);
});

it('returns [] for an unknown id', async () => {
  const t = await setup();
  expect(t.context(12345)).toEqual([]);
});
