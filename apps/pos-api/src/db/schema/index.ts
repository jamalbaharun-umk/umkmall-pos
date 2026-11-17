// Every POS table is exported here. A new table: add `.enableRLS()` and a tenantId column
// (test/db.e2e-spec.ts fails on a pos table without RLS).
export * from './tenants';
export * from './catalog';
export * from './handoff-jtis';
export * from './staff';
