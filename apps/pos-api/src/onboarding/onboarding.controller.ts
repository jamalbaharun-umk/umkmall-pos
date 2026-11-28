import {
  Body,
  Controller,
  Get,
  HttpCode,
  Module,
  Param,
  Post,
} from '@nestjs/common';
import { z } from 'zod';
import { CatalogModule } from '../catalog/catalog.module';
import { parseBody } from '../staff/http';
import { RequirePermission } from '../staff/require-permission';
import { CurrentSession } from '../tenancy/decorators';
import type { PosSession } from '../tenancy/session';
import { OnboardingService } from './onboarding.service';

const TemplateKey = z.string().regex(/^[a-z_]{1,40}$/);

const PricesInput = z
  .object({
    items: z
      .array(
        z
          .object({
            id: z.string().uuid(),
            sellingPrice: z
              .number({ invalid_type_error: 'Harga jual harus berupa angka' })
              .int('Harga jual harus bilangan bulat rupiah')
              .positive('Harga jual harus lebih dari 0')
              .max(1_000_000_000_000, 'Harga jual terlalu besar'),
          })
          .strict(),
      )
      .min(1, 'Isi minimal satu harga')
      .max(200, 'Maksimal 200 produk sekali simpan')
      .refine(
        (xs) => new Set(xs.map((x) => x.id)).size === xs.length,
        'Produk ganda',
      ),
  })
  .strict();

/**
 * UMK-2128: business templates and "Isi harga" (design 44). Every route sets up the catalog: `catalog.manage`. Not an
 * agent route (the agent creates products one by one with its own tool).
 */
@Controller('onboarding')
export class OnboardingController {
  constructor(private readonly onboarding: OnboardingService) {}

  @Get('templates')
  @RequirePermission('catalog.manage')
  templates() {
    return { data: this.onboarding.templates() };
  }

  @Post('templates/:key/apply')
  @HttpCode(200)
  @RequirePermission('catalog.manage')
  apply(@CurrentSession() s: PosSession, @Param('key') key: string) {
    const parsed = TemplateKey.safeParse(key);
    return this.onboarding.apply(s.tenantId, parsed.success ? key : '');
  }

  @Get('unpriced')
  @RequirePermission('catalog.manage')
  unpriced(@CurrentSession() s: PosSession) {
    return this.onboarding.unpriced(s.tenantId);
  }

  @Post('prices')
  @HttpCode(200)
  @RequirePermission('catalog.manage')
  prices(@CurrentSession() s: PosSession, @Body() body: unknown) {
    return this.onboarding.setPrices(
      s.tenantId,
      parseBody(PricesInput, body).items,
    );
  }
}

@Module({
  imports: [CatalogModule],
  controllers: [OnboardingController],
  providers: [OnboardingService],
})
export class OnboardingModule {}
