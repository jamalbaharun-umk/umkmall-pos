// What the staff audit log records (UMK-1969, design 32 "Tercatat"): sign-in, price change, void and refund, shift
// open and close, staff and role changes, device binding, manual drawer cash, and the payment correction (a
// refund marked returned by hand). Nothing else is written. A new code is added here (and to `AUDIT_EVENTS`'s groups).

export const AUDIT_GROUPS = ['money', 'access', 'shift'] as const;
export type AuditGroup = (typeof AUDIT_GROUPS)[number];

/** event code -> the filter chip it belongs to (Uang, Akses, Shift). */
export const AUDIT_EVENTS = {
  void: 'money',
  refund: 'money',
  refund_manual: 'money',
  refund_retry: 'money',
  discount_approval: 'money',
  price_override: 'money',
  drawer_cash_in: 'money',
  drawer_cash_out: 'money',
  shift_open: 'shift',
  shift_close: 'shift',
  sign_in: 'access',
  approval_pin_set: 'access',
  approval_pin_unlock: 'access',
  approval_pin_reset: 'access',
  staff_create: 'access',
  staff_update: 'access',
  staff_delete: 'access',
  role_create: 'access',
  role_update: 'access',
  role_delete: 'access',
  device_bind: 'access',
  device_pair: 'access',
  device_revoke: 'access',
  session_revoke: 'access',
} as const satisfies Record<string, AuditGroup>;

export type AuditEvent = keyof typeof AUDIT_EVENTS;
export const AUDIT_EVENT_CODES = Object.keys(AUDIT_EVENTS) as [
  AuditEvent,
  ...AuditEvent[],
];
