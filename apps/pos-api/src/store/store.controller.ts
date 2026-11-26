import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Module,
  NotFoundException,
  Post,
  Put,
  Res,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { randomUUID } from 'node:crypto';
import type { Response } from 'express';
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import {
  detectImage,
  LocalDiskStorage,
  OBJECT_STORAGE,
  type ObjectStorage,
} from '../catalog/storage';
import { fieldError, validate } from '../common/validation';
import { loadEnv } from '../config';
import type { Db } from '../db/db.module';
import { InjectDb } from '../db/db.module';
import { BUSINESS_TYPES, storeProfiles } from '../db/schema';
import { RequirePermission } from '../staff/require-permission';
import { AgentRoute, CurrentSession } from '../tenancy/decorators';
import type { PosSession } from '../tenancy/session';
import { Inject } from '@nestjs/common';

const MAX_LOGO_BYTES = 2 * 1024 * 1024;
const LOGO_ERROR = 'Logo harus JPG, PNG atau WebP, maksimal 2 MB';
const MAX_QRIS_BYTES = 2 * 1024 * 1024;
const QRIS_ERROR = 'Kode QRIS harus JPG, PNG atau WebP, maksimal 2 MB';

const text = (field: string, max: number) =>
  z
    .string({ required_error: `${field} wajib diisi` })
    .trim()
    .min(1, `${field} wajib diisi`)
    .max(max, `Maksimal ${max} karakter`);

const ProfileInput = z
  .object({
    name: text('Nama toko', 120),
    businessType: z.enum(BUSINESS_TYPES, {
      required_error: 'Pilih jenis usaha',
      invalid_type_error: 'Pilih jenis usaha',
    }),
    otherBusinessType: z
      .string()
      .trim()
      .max(60, 'Maksimal 60 karakter')
      .optional(),
    address: text('Alamat toko', 500),
  })
  .strict()
  .refine((p) => p.businessType !== 'other' || Boolean(p.otherBusinessType), {
    message: 'Jenis usaha lainnya wajib diisi',
    path: ['otherBusinessType'],
  });

/**
 * The store profile (Lakasir General Setting → About/Profile): shop name, business type, address and logo. Any
 * session reads it (the shell shows the store name); editing needs catalog.manage (owners hold every permission).
 * Tax (`/sales/settings`) and timezone (`/reports/settings`) keep their own endpoints; the settings page shows all.
 */
@Controller('store/profile')
export class StoreController {
  constructor(
    @InjectDb() private readonly db: Db,
    @Inject(OBJECT_STORAGE) private readonly storage: ObjectStorage,
  ) {}

  private async row(tenantId: string) {
    const [row] = await this.db
      .select()
      .from(storeProfiles)
      .where(eq(storeProfiles.tenantId, tenantId));
    return row;
  }

  private present(row: Awaited<ReturnType<StoreController['row']>>) {
    return {
      name: row?.name ?? null,
      businessType: row?.businessType ?? null,
      otherBusinessType: row?.otherBusinessType ?? null,
      address: row?.address ?? null,
      hasLogo: Boolean(row?.logoKey),
      // UMK-1992: the cashier's wallet step needs to know whether a QRIS image exists.
      qrisConfigured: Boolean(row?.qrisKey),
      updatedAt: row?.updatedAt ?? null,
    };
  }

  // The agent's business_context reads it (New Teman AI: the business layer of context).
  @AgentRoute()
  @Get()
  async get(@CurrentSession() s: PosSession) {
    return this.present(await this.row(s.tenantId));
  }

  @Put()
  @RequirePermission('catalog.manage')
  async save(@CurrentSession() s: PosSession, @Body() body: unknown) {
    const input = validate(ProfileInput, body);
    const values = {
      name: input.name,
      businessType: input.businessType,
      otherBusinessType:
        input.businessType === 'other' ? input.otherBusinessType : null,
      address: input.address,
    };
    await this.db
      .insert(storeProfiles)
      .values({ tenantId: s.tenantId, ...values })
      .onConflictDoUpdate({
        target: storeProfiles.tenantId,
        set: { ...values, updatedAt: new Date() },
      });
    return this.present(await this.row(s.tenantId));
  }

  @Post('logo')
  @RequirePermission('catalog.manage')
  @UseInterceptors(
    FileInterceptor('file', {
      limits: { fileSize: MAX_LOGO_BYTES + 1, files: 1 },
    }),
  )
  async uploadLogo(
    @CurrentSession() s: PosSession,
    @UploadedFile() file: { buffer: Buffer } | undefined,
  ) {
    const current = await this.row(s.tenantId);
    if (!current)
      throw fieldError(
        'file',
        'Simpan profil toko dulu sebelum mengunggah logo',
        409,
      );
    const kind =
      file && file.buffer.length <= MAX_LOGO_BYTES
        ? detectImage(file.buffer)
        : null;
    if (!kind) throw fieldError('file', LOGO_ERROR);
    const key = `tenants/${s.tenantId}/store/logo-${randomUUID()}.${kind.ext}`;
    await this.storage.put(key, file!.buffer);
    try {
      await this.db
        .update(storeProfiles)
        .set({
          logoKey: key,
          logoContentType: kind.contentType,
          updatedAt: new Date(),
        })
        .where(eq(storeProfiles.tenantId, s.tenantId));
    } catch (e) {
      await this.storage.delete(key);
      throw e;
    }
    if (current.logoKey) await this.storage.delete(current.logoKey);
    return this.present(await this.row(s.tenantId));
  }

  @Get('logo')
  async logo(@CurrentSession() s: PosSession, @Res() res: Response) {
    const row = await this.row(s.tenantId);
    const body = row?.logoKey ? await this.storage.get(row.logoKey) : null;
    if (!body || !row?.logoContentType) throw new NotFoundException();
    res
      .set({
        'Content-Type': row.logoContentType,
        'X-Content-Type-Options': 'nosniff',
        'Cache-Control': 'private, max-age=300',
      })
      .send(body);
  }

  @Delete('logo')
  @RequirePermission('catalog.manage')
  @HttpCode(204)
  async deleteLogo(@CurrentSession() s: PosSession) {
    const row = await this.row(s.tenantId);
    if (!row?.logoKey) throw new NotFoundException();
    await this.db
      .update(storeProfiles)
      .set({ logoKey: null, logoContentType: null, updatedAt: new Date() })
      .where(eq(storeProfiles.tenantId, s.tenantId));
    await this.storage.delete(row.logoKey);
  }

  // UMK-1992: the store's static QRIS. Same rules as the logo: catalog.manage writes, any session reads (the
  // cashier shows it to the customer in the wallet payment step).
  @Post('qris')
  @RequirePermission('catalog.manage')
  @UseInterceptors(
    FileInterceptor('file', {
      limits: { fileSize: MAX_QRIS_BYTES + 1, files: 1 },
    }),
  )
  async uploadQris(
    @CurrentSession() s: PosSession,
    @UploadedFile() file: { buffer: Buffer } | undefined,
  ) {
    const current = await this.row(s.tenantId);
    if (!current)
      throw fieldError(
        'file',
        'Simpan profil toko dulu sebelum mengunggah kode QRIS',
        409,
      );
    const kind =
      file && file.buffer.length <= MAX_QRIS_BYTES
        ? detectImage(file.buffer)
        : null;
    if (!kind) throw fieldError('file', QRIS_ERROR);
    const key = `tenants/${s.tenantId}/store/qris-${randomUUID()}.${kind.ext}`;
    await this.storage.put(key, file!.buffer);
    try {
      await this.db
        .update(storeProfiles)
        .set({
          qrisKey: key,
          qrisContentType: kind.contentType,
          updatedAt: new Date(),
        })
        .where(eq(storeProfiles.tenantId, s.tenantId));
    } catch (e) {
      await this.storage.delete(key);
      throw e;
    }
    if (current.qrisKey) await this.storage.delete(current.qrisKey);
    return this.present(await this.row(s.tenantId));
  }

  @Get('qris')
  async qris(@CurrentSession() s: PosSession, @Res() res: Response) {
    const row = await this.row(s.tenantId);
    const body = row?.qrisKey ? await this.storage.get(row.qrisKey) : null;
    if (!body || !row?.qrisContentType) throw new NotFoundException();
    res
      .set({
        'Content-Type': row.qrisContentType,
        'X-Content-Type-Options': 'nosniff',
        'Cache-Control': 'private, max-age=300',
      })
      .send(body);
  }

  @Delete('qris')
  @RequirePermission('catalog.manage')
  @HttpCode(204)
  async deleteQris(@CurrentSession() s: PosSession) {
    const row = await this.row(s.tenantId);
    if (!row?.qrisKey) throw new NotFoundException();
    await this.db
      .update(storeProfiles)
      .set({ qrisKey: null, qrisContentType: null, updatedAt: new Date() })
      .where(eq(storeProfiles.tenantId, s.tenantId));
    await this.storage.delete(row.qrisKey);
  }
}

@Module({
  controllers: [StoreController],
  providers: [
    {
      provide: OBJECT_STORAGE,
      useFactory: () => new LocalDiskStorage(loadEnv().POS_STORAGE_DIR),
    },
  ],
})
export class StoreModule {}
