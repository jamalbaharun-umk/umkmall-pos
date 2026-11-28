// What the staff audit log records (UMK-1969, design 32 "Tercatat"): sign-in, price change, void and refund, shift
// open and close, staff and role changes, device binding, manual drawer cash, the payment correction (a
// refund marked returned by hand), a kasbon instalment corrected by PIN (UMK-1971) and the supplier money of a
// purchase (UMK-1970: payment void, money back and its void, return undone) and a production run (UMK-2132). Nothing else is written. A new code is added here (and to `AUDIT_EVENTS`'s groups).

export const AUDIT_GROUPS = ['money', 'access', 'shift'] as const;
export type AuditGroup = (typeof AUDIT_GROUPS)[number];

/** event code -> the filter chip it belongs to (Uang, Akses, Shift). */
export const AUDIT_EVENTS = {
  void: 'money',
  refund: 'money',
  refund_manual: 'money',
  refund_retry: 'money',
  kasbon_correction: 'money',
  discount_approval: 'money',
  price_override: 'money',
  drawer_cash_in: 'money',
  drawer_cash_out: 'money',
  // UMK-1970: a supplier payment voided, money a supplier handed back (and its void), a purchase return undone.
  purchase_payment_void: 'money',
  purchase_refund: 'money',
  purchase_refund_void: 'money',
  purchase_return_undo: 'money',
  // UMK-2132: a production run (ingredients out, the finished batch in at its real cost).
  production_run: 'money',
  shift_open: 'shift',
  shift_close: 'shift',
  // Design 40 screen 7: the owner corrected the opening cash of a shift that opened by itself.
  shift_opening_correct: 'shift',
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
