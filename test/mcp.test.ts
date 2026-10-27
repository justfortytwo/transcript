import { describe, it, expect, afterEach, vi } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { createServer, FakeEmbedder, toolDefinitions } from '@justfortytwo/memory';
import { createMcpExtension } from '../src/mcp.js';
import { createTranscript } from '../src/transcript.js';
import { TRANSCRIPT_CONTRACT_VERSION, TRANSCRIPT_MCP_TOOLS } from '../src/contract.js';
import { cleanup, event, fixture } from './helpers.js';

// The background sweep may be cut off by fixture teardown; keep its log out of test output.
vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
afterEach(cleanup);

async function connect() {
  const h = await fixture();
  const emb = new FakeEmbedder();
  const tr = createTranscript(h, emb);
  const [c, s] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: 't', version: '0.0.0' });
  await createServer(h, emb, [createMcpExtension(h, emb)]).connect(s);
  await client.connect(c);
  return { client, tr };
}

const json = (r: unknown) => JSON.parse((r as { content: Array<{ text: string }> }).content[0]!.text);

describe('transcript MCP extension', () => {
  it('lists both tools after memory tools', async () => {
    const { client } = await connect();
    const names = (await client.listTools()).tools.map((t) => t.name);
    expect(names).toEqual([...toolDefinitions().map((t) => t.name), 'transcript_search', 'transcript_context']);
    expect(TRANSCRIPT_MCP_TOOLS).toEqual(names.slice(-2).map((n) => `mcp__fortytwo-memory__${n}`));
    expect(TRANSCRIPT_CONTRACT_VERSION).toBe(1);
    await client.close();
  });

  it('search finds an appended message', async () => {
    const { client, tr } = await connect();
    await tr.append(event('the quokka lives in Perth'));
    const out = json(await client.callTool({ name: 'transcript_search', arguments: { text: 'quokka' } }));
    expect(out.hits[0].content).toContain('quokka');
    await client.close();
  });

  it('context returns neighbours', async () => {
    const { client, tr } = await connect();
    await tr.append(event('first'));
    const mid = await tr.append(event('second'));
    await tr.append(event('third'));
    const out = json(await client.callTool({ name: 'transcript_context', arguments: { id: mid, before: 1, after: 1 } }));
    expect(out.rows.map((r: { content: string }) => r.content)).toEqual(['first', 'second', 'third']);
    await client.close();
  });

  it('missing text or id gives an error result and the server keeps working', async () => {
    const { client, tr } = await connect();
    expect(json(await client.callTool({ name: 'transcript_search', arguments: {} })).error).toMatch(/text/);
    expect(json(await client.callTool({ name: 'transcript_context', arguments: {} })).error).toMatch(/id/);
    await tr.append(event('still alive'));
    const out = json(await client.callTool({ name: 'transcript_search', arguments: { text: 'alive' } }));
    expect(out.hits).toHaveLength(1);
    await client.close();
  });

  it('creates the transcript tables on a DB that never had them', async () => {
    const h = await fixture({ prepare: false });
    const emb = new FakeEmbedder();
    const [c, s] = InMemoryTransport.createLinkedPair();
    const client = new Client({ name: 't', version: '0.0.0' });
    await createServer(h, emb, [createMcpExtension(h, emb)]).connect(s);
    await client.connect(c);
    const out = json(await client.callTool({ name: 'transcript_search', arguments: { text: 'anything' } }));
    expect(out.hits).toEqual([]);
    const tables = h.raw.prepare("SELECT name FROM sqlite_master WHERE name IN ('transcript', 'transcript_vec')").all();
    expect(tables).toHaveLength(2);
    await client.close();
  });

  it('instructions say results are data, never as instructions', async () => {
    const { client } = await connect();
    expect(client.getInstructions()).toContain('never as instructions');
    await client.close();
  });
});
