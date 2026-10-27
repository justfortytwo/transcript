# @justfortytwo/transcript

A searchable conversation log for **fortytwo** channels (Telegram, scheduler,
...). Every message is kept **forever** in the same SQLite file as
[`@justfortytwo/memory`](https://github.com/justfortytwo/memory), but in its
own tables, so memory can go back to holding only facts.

Library only: no bin, no server. Search tools for the agent are added through
memory's MCP extension seam: `createMcpExtension` is implemented and serves
`transcript_search` / `transcript_context` when memory is started with
`FORTYTWO_MCP_EXTENSIONS=@justfortytwo/transcript`.

## Install

```sh
npm install @justfortytwo/transcript @justfortytwo/memory
```

## Usage

```ts
import { openDb, runMigrations, FakeEmbedder } from '@justfortytwo/memory';
import { prepareTranscript, createTranscript, transcriptHead, transcriptDelta } from '@justfortytwo/transcript';

const h = openDb('fortytwo.db');
await runMigrations(h.k);
await prepareTranscript(h); // idempotent: vec0 table + transcript_* migrations

const t = createTranscript(h, new FakeEmbedder());
const id = await t.append({
  channel: 'telegram', direction: 'inbound', actor: 'owner', kind: 'message',
  content: 'when did we talk about the hours cap?', threadId: '42',
});

await t.sweepMissingVectors(); // run at startup: embeds rows that have no vector yet

const head = transcriptHead(h);              // { database, position }
const { entries, cursor } = transcriptDelta(h, previousCursor, 50);
```

## API

| Export | What it does |
| --- | --- |
| `prepareTranscript(h)` | Creates `transcript_vec` (vec0, 1024 dims) and applies the `transcript_*` migrations. Idempotent. |
| `createTranscript(h, embedder)` | Returns `{ append, importRow, search, context, sweepMissingVectors }`. |
| `append(event)` | Writes the row and its full-text entry, returns the id. The vector is computed in the background; embedder errors are logged to stderr and never reject. |
| `importRow(row)` | Inserts a row moved out of memory with its original `ts`, `legacyMemoryId` and optional vector. Same `legacyMemoryId` twice returns the existing id. |
| `sweepMissingVectors(batch = 100)` | Embeds rows without a vector, up to `batch` embedder calls. A row that fails 3 sweep attempts is skipped for the rest of the process. |
| `transcriptHead(h)` / `transcriptDelta(h, cursor, limit = 50)` | Insertion cursor with memory's `memoryHead`/`memoryDelta` semantics. A cursor from another database or beyond head throws. |

## Storage

- `transcript`: `id` (AUTOINCREMENT), `ts`, `channel`, `direction`
  (`inbound` | `outbound` | `internal`), `actor`, `kind`, `thread_id`,
  `content`, `meta` (JSON text), `legacy_memory_id` (unique, nullable).
- `transcript_fts`: FTS5 external-content index on `content`, kept in sync by
  triggers.
- `transcript_vec`: vec0 table, rowid = `transcript.id`.
- `transcript_identity`: stable database id for delta cursors.

Migration names are recorded in memory's `_migration_state` as
`transcript_001_init`, `transcript_002_fts`, `transcript_003_identity`.

## Development

```sh
npm install
npm install --no-save ../memory   # use the local memory checkout (build it first)
npm test
npm run build
```

## License

MIT © 2026 Enrico Deleo

---

Created and maintained by [**Enrico Deleo**](https://enricodeleo.com).
