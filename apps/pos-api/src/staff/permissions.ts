// Code-defined permission keys (Lakasir kept them as DB rows per guard). A role may hold only these.
export const PERMISSIONS = [
  'sales.create',
  'sales.price_override',
  'catalog.manage',
  'reports.view',
  'staff.manage',
  'purchasing.manage',
  'members.manage',
  'vouchers.manage',
  'receivables.manage',
  'sales.void',
  'expenses.manage',
  // Receives a collector's outside-shift cash into the store safe (UMK-1924 U3).
  'store_cash.manage',
] as const;

export type Permission = (typeof PERMISSIONS)[number];

// Seeded for a store the first time its roles are used.
export const DEFAULT_ROLES: {
  name: string;
  permissions: readonly Permission[];
}[] = [
  { name: 'Pemilik', permissions: PERMISSIONS },
  { name: 'Kasir', permissions: ['sales.create'] },
];
