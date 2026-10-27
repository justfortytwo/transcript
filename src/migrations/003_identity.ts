import { randomUUID } from 'node:crypto';
import type { Migration } from '@justfortytwo/memory';

type Knex = Parameters<Migration['up']>[0];

// Stable identity for delta cursors; a replacement database fails closed.
export async function up(k: Knex): Promise<void> {
  await k.schema.createTable('transcript_identity', (t) => { t.integer('id').primary(); t.text('identity').notNullable(); });
  await k('transcript_identity').insert({ id: 1, identity: randomUUID() });
}

export async function down(k: Knex): Promise<void> {
  await k.schema.dropTableIfExists('transcript_identity');
}
