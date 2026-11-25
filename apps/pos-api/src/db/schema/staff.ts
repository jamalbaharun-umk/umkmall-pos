import {
  boolean,
  foreignKey,
  integer,
  primaryKey,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { createdAt, id, pos, updatedAt } from './_base';
import { tenants } from './tenants';

// U4: cashiers are local POS users (never UMKMall accounts), signed in by PIN on a bound device.
// Link tables use composite (tenant_id, id) FKs so a row can never join two stores.

const tenantId = () =>
  uuid('tenant_id')
    .notNull()
    .references(() => tenants.id, { onDelete: 'restrict' });

const ts = (name: string) => timestamp(name, { withTimezone: true });

export const staff = pos
  .table(
    'staff',
    {
      id: id(),
      tenantId: tenantId(),
      name: text('name').notNull(),
      pinHash: text('pin_hash').notNull(), // scrypt, see staff/secrets.ts
      active: boolean('active').notNull().default(true),
      deletedAt: ts('deleted_at'),
      createdAt: createdAt(),
      updatedAt: updatedAt(),
    },
    (t) => [
      unique().on(t.tenantId, t.id),
      // Live staff names are unique ignoring case, so the PIN picker never shows two identical names.
      uniqueIndex('staff_tenant_name_uq')
        .on(t.tenantId, sql`lower(${t.name})`)
        .where(sql`${t.deletedAt} is null`),
    ],
  )
  .enableRLS();

export const roles = pos
  .table(
    'roles',
    {
      id: id(),
      tenantId: tenantId(),
      name: text('name').notNull(),
      createdAt: createdAt(),
    },
    // Role names are unique ignoring case ("Kasir" = "kasir").
    (t) => [
      uniqueIndex('roles_tenant_name_uq').on(t.tenantId, sql`lower(${t.name})`),
      unique().on(t.tenantId, t.id),
    ],
  )
  .enableRLS();

export const rolePermissions = pos
  .table(
    'role_permissions',
    {
      tenantId: tenantId(),
      roleId: uuid('role_id').notNull(),
      permission: text('permission').notNull(), // a key from staff/permissions.ts
    },
    (t) => [
      primaryKey({ columns: [t.roleId, t.permission] }),
      foreignKey({
        columns: [t.tenantId, t.roleId],
        foreignColumns: [roles.tenantId, roles.id],
      }).onDelete('cascade'),
    ],
  )
  .enableRLS();

export const staffRoles = pos
  .table(
    'staff_roles',
    {
      tenantId: tenantId(),
      staffId: uuid('staff_id').notNull(),
      roleId: uuid('role_id').notNull(),
    },
    (t) => [
      primaryKey({ columns: [t.staffId, t.roleId] }),
      foreignKey({
        columns: [t.tenantId, t.staffId],
        foreignColumns: [staff.tenantId, staff.id],
      }).onDelete('cascade'),
      foreignKey({
        columns: [t.tenantId, t.roleId],
        foreignColumns: [roles.tenantId, roles.id],
      }).onDelete('cascade'),
    ],
  )
  .enableRLS();

export const devices = pos
  .table(
    'devices',
    {
      id: id(),
      tenantId: tenantId(),
      name: text('name').notNull(),
      secretHash: text('secret_hash').notNull(), // sha256 of a 32-byte random secret
      revokedAt: ts('revoked_at'),
      createdAt: createdAt(),
    },
    (t) => [unique().on(t.tenantId, t.id)],
  )
  .enableRLS();

export const staffSessions = pos
  .table(
    'staff_sessions',
    {
      id: id(),
      tenantId: tenantId(),
      staffId: uuid('staff_id').notNull(),
      deviceId: uuid('device_id').notNull(),
      expiresAt: ts('expires_at').notNull(),
      revokedAt: ts('revoked_at'),
      createdAt: createdAt(),
    },
    (t) => [
      foreignKey({
        columns: [t.tenantId, t.staffId],
        foreignColumns: [staff.tenantId, staff.id],
      }).onDelete('cascade'),
      foreignKey({
        columns: [t.tenantId, t.deviceId],
        foreignColumns: [devices.tenantId, devices.id],
      }).onDelete('cascade'),
    ],
  )
  .enableRLS();

// Lockout state per store + cashier.
export const pinAttempts = pos
  .table(
    'pin_attempts',
    {
      tenantId: tenantId(),
      staffId: uuid('staff_id').notNull(),
      failures: integer('failures').notNull().default(0),
      lockedUntil: ts('locked_until'),
    },
    (t) => [
      primaryKey({ columns: [t.tenantId, t.staffId] }),
      foreignKey({
        columns: [t.tenantId, t.staffId],
        foreignColumns: [staff.tenantId, staff.id],
      }).onDelete('cascade'),
    ],
  )
  .enableRLS();

// UMK-2022: pairing a cashier device by code. The signed-out device asks for a 6-digit code and shows it; the
// owner enters it on their own signed-in device, which binds the device to that session's store.
export const devicePairings = pos
  .table(
    'device_pairings',
    {
      id: id(),
      // Null until the owner enters the code: before that the device belongs to no store. Set from the
      // owner's session, never from a request.
      tenantId: uuid('tenant_id').references(() => tenants.id, {
        onDelete: 'restrict',
      }),
      // sha256 of the 6-digit code; the code itself is never stored. Null once used: a code works once.
      codeHash: text('code_hash'),
      // sha256 of the secret only the asking device holds. It becomes the bound device's secret.
      secretHash: text('secret_hash').notNull(),
      // sha256 of the network address that asked for the code: the per-address cap on open codes counts it.
      // The address itself is not stored.
      requesterHash: text('requester_hash'),
      // The code's end; after the claim, the end of the time the device may still fetch its token.
      expiresAt: ts('expires_at').notNull(),
      claimedAt: ts('claimed_at'),
      deviceId: uuid('device_id'),
      createdAt: createdAt(),
    },
    (t) => [
      // Two open pairings never share a code.
      uniqueIndex('device_pairings_code_uq').on(t.codeHash),
      foreignKey({
        columns: [t.tenantId, t.deviceId],
        foreignColumns: [devices.tenantId, devices.id],
      }).onDelete('cascade'),
    ],
  )
  .enableRLS();

// Wrong pairing codes per store: the same lock as PIN sign-in (pin_attempts).
export const devicePairingAttempts = pos
  .table('device_pairing_attempts', {
    tenantId: uuid('tenant_id')
      .primaryKey()
      .references(() => tenants.id, { onDelete: 'restrict' }),
    failures: integer('failures').notNull().default(0),
    lockedUntil: ts('locked_until'),
  })
  .enableRLS();
