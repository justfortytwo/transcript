# AGENTS.md

Guidance for AI coding agents working in `@justfortytwo/transcript`.

## What this is

A conversation log for fortytwo channels, stored in the same SQLite file as
`@justfortytwo/memory` but in its own tables. Library only (no bin). Design:
`justfortytwo/docs`, spec `superpowers/specs/2026-10-27-transcript-design.md`.

## Layout

```
src/
  index.ts              public re-exports (no side effects on import)
  types.ts              Direction, TranscriptEvent, TranscriptRow, ImportRow, Cursor, Transcript
  db.ts                 prepareTranscript(): transcript_vec on the raw handle + TRANSCRIPT_MIGRATIONS
  transcript.ts         createTranscript(): append, importRow, sweepMissingVectors
  delta.ts              transcriptHead / transcriptDelta (insertion cursor)
  migrations/00N_*.ts   001_init, 002_fts, 003_identity (recorded as transcript_00N_*)
test/*.test.ts          vitest suites; test/helpers.ts builds temp DBs
.github/workflows/ci.yml shared justfortytwo/.github node-ci.yml with siblings: "memory"
```

## Commands

```bash
npm run build       # tsc -> dist/
npm test            # vitest run
npm run test:watch  # vitest
```

Local memory: build `../memory` first, then `npm install` and
`npm install --no-save ../memory`. Never put a local path in package.json and
do not use `npm link`.

## Conventions

- TypeScript strict, ESM, NodeNext: relative imports end in `.js`, tests too.
- Tests use temp DBs (`mkdtempSync(tmpdir())`) and `FakeEmbedder`.
- Commit style: `feat(transcript): ...`, `docs(transcript): ...`.
- New public API is re-exported from `src/index.ts`.

## Invariants

- **Retention is forever.** No delete function, no MCP delete tool, no expiry.
- **Same DB file as memory.** Migration names start with `transcript_` and live
  in memory's `_migration_state`. Append new ones to `TRANSCRIPT_MIGRATIONS`.
- **One-way dependency.** Transcript imports from `@justfortytwo/memory` only:
  `openDb`, `DbHandles`, `applyMigrations`, `Migration`, `Embedder`,
  `vecToBuffer`, `EMBED_DIM`, `McpExtension`. Memory never imports transcript.
- **Embedding never blocks `append`.** The row and FTS entry are written
  synchronously; the vector is written in the background, errors go to stderr.
  `sweepMissingVectors` fills gaps (3 attempts per row per process).
- vec0 rowids are bound as `BigInt(id)`; a plain Number fails vec0's check.
- Vector dimension is 1024 (`EMBED_DIM`).
- Delta cursors use `transcript_identity` plus the `sqlite_sequence` watermark,
  not `MAX(id)`, so they survive deletion of the newest rows.

## Gotchas

- Do not import `knex` directly. Migrations take the `Knex` type from memory's
  `Migration` (`Parameters<Migration['up']>[0]`). With a linked local memory,
  a second knex copy in this package makes the types incompatible.
- `@types/better-sqlite3` is a devDependency because memory's `DbHandles`
  type refers to better-sqlite3 types.
