export type Direction = 'inbound' | 'outbound' | 'internal';

/** One channel event to log. Channel-agnostic: telegram, scheduler, ... */
export interface TranscriptEvent {
  channel: string;
  direction: Direction;
  actor: string;
  kind: string;
  content: string;
  threadId?: string | null;
  meta?: Record<string, unknown>;
}

/** A stored `transcript` row, as SQLite returns it. */
export interface TranscriptRow {
  id: number;
  ts: string;
  channel: string;
  direction: Direction;
  actor: string;
  kind: string;
  thread_id: string | null;
  content: string;
  /** JSON object text. */
  meta: string;
  legacy_memory_id: number | null;
}

/** A row moved out of `memories`: keeps its timestamp, old id and (optionally) its vector. */
export interface ImportRow extends TranscriptEvent {
  ts: string;
  legacyMemoryId: number;
  /** Raw float32 bytes of an existing EMBED_DIM vector (e.g. copied from memory_vec). */
  embedding?: Buffer;
}

export interface Cursor {
  database: string;
  position: number;
}

export interface Transcript {
  /** Writes the row and FTS entry synchronously; the vector is produced in the background. */
  append(e: TranscriptEvent): Promise<number>;
  /** Idempotent on `legacyMemoryId`: returns the existing id without inserting. */
  importRow(r: ImportRow): number;
  /** Embeds up to `batch` rows that have no vector. Returns how many were embedded. */
  sweepMissingVectors(batch?: number): Promise<number>;
}
