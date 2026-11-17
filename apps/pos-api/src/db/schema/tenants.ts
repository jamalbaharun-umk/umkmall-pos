import { createdAt, id, pos } from './_base';
import { uuid } from 'drizzle-orm/pg-core';
import { umkmallUsers } from '../external';

// One UMKMall account = one store (UMK-1924). RESTRICT, not CASCADE: UMKMall archival never deletes
// the users row, so erasure is an explicit purge (U8) and a forgotten purge fails loudly.
export const tenants = pos
  .table('tenants', {
    id: id(),
    userId: uuid('user_id')
      .notNull()
      .unique()
      .references(() => umkmallUsers.id, { onDelete: 'restrict' }),
    createdAt: createdAt(),
  })
  .enableRLS();
