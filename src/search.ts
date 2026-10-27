import type { DbHandles, Embedder } from '@justfortytwo/memory';
import { vecToBuffer } from '@justfortytwo/memory';
import type { SearchHit, SearchOpts, TranscriptRow } from './types.js';

const RRF_K = 60;
const DEFAULT_LIMIT = 10;
const MAX_LIMIT = 50;
/** Candidates pulled per leg before filtering and fusion. */
const CANDIDATES = 200;
const MAX_CONTEXT = 20;

function clamp(n: number | undefined, lo: number, hi: number, dflt: number): number {
  if (n === undefined || !Number.isFinite(n)) return dflt;
  return Math.min(hi, Math.max(lo, Math.trunc(n)));
}

interface Filter { sql: string; params: Record<string, string> }

function filterOf(o: SearchOpts): Filter {
  const parts: string[] = [];
  const params: Record<string, string> = {};
  if (o.since !== undefined) { parts.push('t.ts >= @since'); params.since = o.since; }
  if (o.until !== undefined) { parts.push('t.ts <= @until'); params.until = o.until; }
  if (o.channel !== undefined) { parts.push('t.channel = @channel'); params.channel = o.channel; }
  if (o.threadId !== undefined) { parts.push('t.thread_id = @thread_id'); params.thread_id = o.threadId; }
  return { sql: parts.map((p) => ` AND ${p}`).join(''), params };
}

function keywordIds(h: DbHandles, text: string, f: Filter): number[] {
  // FTS5 MATCH treats spaces as AND; quote each token (as memory's lexical does) so operators are inert.
  const safe = text.split(/\s+/).filter(Boolean).map((t) => `"${t.replace(/"/g, '""')}"`).join(' ');
  const rows = h.raw
    .prepare(
      `SELECT t.id FROM transcript_fts f JOIN transcript t ON t.id = f.rowid
        WHERE transcript_fts MATCH @q${f.sql}
        ORDER BY rank LIMIT @lim`,
    )
    .all({ ...f.params, q: safe, lim: CANDIDATES }) as Array<{ id: number }>;
  return rows.map((r) => r.id);
}

/** Runs the vector SQL; errors here are real bugs and must surface. */
function semanticIds(h: DbHandles, qv: Buffer, f: Filter): number[] {
  // Unfiltered: portable `k = ?` KNN (see memory's recall). Filtered: the KNN would take the global
  // top-k before filtering and could miss matching rows, so rank the filtered rows by exact L2
  // distance (the vec0 default metric) instead.
  const sql = f.sql === ''
    ? `SELECT t.id FROM transcript_vec v JOIN transcript t ON t.id = v.rowid
        WHERE v.embedding MATCH @qv AND k = @k ORDER BY v.distance`
    : `SELECT t.id FROM transcript_vec v JOIN transcript t ON t.id = v.rowid
        WHERE 1 = 1${f.sql}
        ORDER BY vec_distance_L2(v.embedding, @qv), t.id LIMIT @k`;
  const rows = h.raw.prepare(sql).all({ ...f.params, qv, k: CANDIDATES }) as Array<{ id: number }>;
  return rows.map((r) => r.id);
}

/** An embedder outage degrades to keyword-only search; only the embed call is guarded. */
async function semanticIdsOrEmpty(h: DbHandles, embedder: Embedder, text: string, f: Filter): Promise<number[]> {
  let qv: Buffer;
  try {
    qv = vecToBuffer(await embedder.embed(text));
  } catch (err) {
    process.stderr.write(`transcript: semantic search unavailable: ${err instanceof Error ? err.message : String(err)}\n`);
    return [];
  }
  return semanticIds(h, qv, f);
}

export async function searchTranscript(h: DbHandles, embedder: Embedder, o: SearchOpts): Promise<SearchHit[]> {
  const text = o.text.trim();
  if (text === '') return [];
  const limit = clamp(o.limit, 1, MAX_LIMIT, DEFAULT_LIMIT);
  const f = filterOf(o);

  const lists: Array<['keyword' | 'semantic', number[]]> = [
    ['keyword', keywordIds(h, text, f)],
    ['semantic', await semanticIdsOrEmpty(h, embedder, text, f)],
  ];
  const fused = new Map<number, { score: number; matched: Array<'keyword' | 'semantic'> }>();
  for (const [name, ids] of lists) {
    ids.forEach((id, rank) => {
      const e = fused.get(id) ?? { score: 0, matched: [] };
      e.score += 1 / (RRF_K + rank + 1);
      e.matched.push(name);
      fused.set(id, e);
    });
  }
  const top = [...fused.entries()].sort((a, b) => b[1].score - a[1].score || a[0] - b[0]).slice(0, limit);
  const get = h.raw.prepare('SELECT * FROM transcript WHERE id = ?');
  return top.map(([id, e]) => ({ ...(get.get(id) as TranscriptRow), score: e.score, matched: e.matched }));
}

export function contextOf(h: DbHandles, id: number, before?: number, after?: number): TranscriptRow[] {
  const hit = h.raw.prepare('SELECT * FROM transcript WHERE id = ?').get(id) as TranscriptRow | undefined;
  if (!hit) return [];
  const b = clamp(before, 0, MAX_CONTEXT, 5);
  const a = clamp(after, 0, MAX_CONTEXT, 5);
  const scope = hit.thread_id === null ? 'channel = @scope' : 'thread_id = @scope';
  const scopeVal = hit.thread_id ?? hit.channel;
  const prev = h.raw
    .prepare(`SELECT * FROM transcript WHERE ${scope} AND id < @id ORDER BY id DESC LIMIT @n`)
    .all({ scope: scopeVal, id, n: b }) as TranscriptRow[];
  const next = h.raw
    .prepare(`SELECT * FROM transcript WHERE ${scope} AND id > @id ORDER BY id ASC LIMIT @n`)
    .all({ scope: scopeVal, id, n: a }) as TranscriptRow[];
  return [...prev.reverse(), hit, ...next];
}
