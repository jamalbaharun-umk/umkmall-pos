import { pgTable, uuid } from 'drizzle-orm/pg-core';

// UMKMall's account table, referenced only for the tenant foreign key. UMKMall owns and migrates it;
// this file sits outside the drizzle schema glob so drizzle-kit never generates SQL for it.
export const umkmallUsers = pgTable('users', {
  id: uuid('id').primaryKey(),
});
