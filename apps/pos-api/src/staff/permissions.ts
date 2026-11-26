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
  // Online payments (UMK-2021): onboarding the store at the payment gateway and switching methods on or off.
  // Held by the owner only by default: no default role but Pemilik carries it.
  'payments.manage',
] as const;

export type Permission = (typeof PERMISSIONS)[number];

/**
 * What the default Admin role does NOT hold (UMK-2021, owner decision 2026-11-25): managing staff, roles and
 * devices, and online payments. Everything else it holds, `sales.void` included. THE one place to change the
 * Admin set; the owner can still edit the role of their own store afterwards.
 *
 * Existing stores got the role from migration 0030, which is a snapshot of this set at that time: changing
 * the constant changes new stores only (test/staff.e2e-spec.ts compares the two and says so).
 */
export const ADMIN_EXCLUDED_PERMISSIONS: readonly Permission[] = [
  'staff.manage',
  'payments.manage',
];

export const ADMIN_PERMISSIONS: readonly Permission[] = PERMISSIONS.filter(
  (p) => !ADMIN_EXCLUDED_PERMISSIONS.includes(p),
);

/**
 * What UMKMall's agent may do for the owner (UMK-1978): fill the catalog and read reports. The agent reaches only
 * routes marked `@AgentRoute()`, so a permission here opens nothing without that mark (store settings, payment
 * methods and the like ask `catalog.manage` but are not marked). Sales, members and suppliers come with UMK-1981.
 */
export const AGENT_PERMISSIONS: readonly Permission[] = [
  'catalog.manage',
  'reports.view',
];

export const ADMIN_ROLE_NAME = 'Admin';

// Seeded for a store the first time its roles are used.
export const DEFAULT_ROLES: {
  name: string;
  permissions: readonly Permission[];
}[] = [
  { name: 'Pemilik', permissions: PERMISSIONS },
  { name: ADMIN_ROLE_NAME, permissions: ADMIN_PERMISSIONS },
  { name: 'Kasir', permissions: ['sales.create'] },
];
