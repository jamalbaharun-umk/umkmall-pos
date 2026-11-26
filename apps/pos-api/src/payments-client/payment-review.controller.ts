import { Controller, Get, Query } from '@nestjs/common';
import { z } from 'zod';
import { validate } from '../common/validation';
import { RequirePermission } from '../staff/require-permission';
import { CurrentSession } from '../tenancy/decorators';
import type { PosSession } from '../tenancy/session';
import { PaymentReview } from './payment-review.service';

const ReviewQuery = z
  .object({
    needsReview: z
      .enum(['true', 'false'], {
        errorMap: () => ({ message: 'Harus true atau false' }),
      })
      .transform((v) => v === 'true')
      .optional(),
    page: z.coerce.number().int().min(1).max(10_000).default(1),
    perPage: z.coerce.number().int().min(1).max(100).default(50),
  })
  .strict('Isian tidak dikenal');

/**
 * "Perlu ditinjau" (UMK-2041): the owner's list of gateway money that paid no sale and of refused refunds.
 * Behind `payments.manage`, which only the owner holds. The tenant is the session's; nothing in the request
 * names a store.
 */
@Controller('payment-review')
export class PaymentReviewController {
  constructor(private readonly review: PaymentReview) {}

  @Get()
  @RequirePermission('payments.manage')
  list(@CurrentSession() s: PosSession, @Query() query: unknown) {
    return this.review.list(s.tenantId, validate(ReviewQuery, query));
  }
}
