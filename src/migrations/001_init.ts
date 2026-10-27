import type { Migration } from '@justfortytwo/memory';

type Knex = Parameters<Migration['up']>[0];

// Conversation log. Retained forever: no expiry column, no delete path.
// The vec0 table (transcript_vec) is created on the raw handle in db.ts,
// because Knex's connection does not load sqlite-vec.
export async function up(k: Knex): Promise<void> {
  await k.schema.createTable('transcript', (t) => {
    t.increments('id').primary(); // AUTOINCREMENT: sqlite_sequence is the delta watermark
    t.datetime('ts', { useTz: false }).notNullable().defaultTo(k.fn.now());
    t.string('channel').notNullable();
    t.enu('direction', ['inbound', 'outbound', 'internal']).notNullable();
    t.string('actor').notNullable();
    t.string('kind').notNullable();
    t.string('thread_id').nullable();
    t.text('content').notNullable();
    t.text('meta').notNullable().defaultTo('{}');
    // Original memories.id for rows moved out of memory; makes the move idempotent.
    t.integer('legacy_memory_id').nullable().unique();
    t.index(['ts']);
    t.index(['channel', 'thread_id']);
  });
}

export async function down(k: Knex): Promise<void> {
  await k.schema.dropTableIfExists('transcript');
}
