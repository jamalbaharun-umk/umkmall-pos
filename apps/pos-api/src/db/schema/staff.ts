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
