// Every POS table is exported here. A new table: add `.enableRLS()` and a tenantId column
// (test/db.e2e-spec.ts fails on a pos table without RLS).
export * from './tenants';
export * from './catalog';
export * from './staff';
export * from './stock';
export * from './purchasing';
export * from './sales';
export * from './reports';
export * from './members';
export * from './receivables';
export * from './shift-cash';
export * from './store-cash';
export * from './voids';
export * from './store';
