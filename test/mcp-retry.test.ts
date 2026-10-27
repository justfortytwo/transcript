import { afterEach, expect, it, vi } from 'vitest';
import { FakeEmbedder } from '@justfortytwo/memory';
import { cleanup, fixture } from './helpers.js';

const { prepareSpy } = vi.hoisted(() => ({ prepareSpy: vi.fn() }));
vi.mock('../src/db.js', async (orig) => {
  const actual = await orig<typeof import('../src/db.js')>();
  prepareSpy.mockImplementation(actual.prepareTranscript);
  return { ...actual, prepareTranscript: prepareSpy };
});

const { createMcpExtension } = await import('../src/mcp.js');

vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
afterEach(cleanup);

it('retries prepare after a failed first attempt', async () => {
  const h = await fixture({ prepare: false });
  prepareSpy.mockRejectedValueOnce(new Error('SQLITE_BUSY: database is locked'));
  const ext = createMcpExtension(h, new FakeEmbedder());
  // Let the failed background prepare settle.
  await new Promise((r) => setTimeout(r, 0));
  expect(await ext.call('transcript_search', { text: 'anything' })).toEqual({ hits: [] });
  expect(prepareSpy).toHaveBeenCalledTimes(2);
});
