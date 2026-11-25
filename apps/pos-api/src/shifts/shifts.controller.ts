import {
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  Param,
  Post,
  Query,
} from '@nestjs/common';
import { z } from 'zod';
import { validate } from '../common/validation';
import { IdempotencyKey } from '../sales/sales.schemas';
import { parseId } from '../staff/http';
import { RequirePermission } from '../staff/require-permission';
import { CurrentSession } from '../tenancy/decorators';
import type { PosSession } from '../tenancy/session';
import { CashEntriesService, CashEntryInput } from './cash-entries.service';
import { ShiftsService } from './shifts.service';

const cash = z.number().int().nonnegative().max(1_000_000_000_000);
const OpenInput = z.object({ openingCash: cash }).strict();
const CloseInput = z.object({ countedCash: cash }).strict();
const Page = z.object({
  page: z.coerce.number().int().min(1).default(1),
  perPage: z.coerce.number().int().min(1).max(100).default(20),
});

@Controller('shifts')
export class ShiftsController {
  constructor(
    private readonly shifts: ShiftsService,
    private readonly cashEntries: CashEntriesService,
  ) {}

  @Get('current')
  @RequirePermission('sales.create')
  async current(@CurrentSession() s: PosSession) {
    return { shift: await this.shifts.current(s) };
  }

  @Post('open')
  @RequirePermission('sales.create')
  open(@CurrentSession() s: PosSession, @Body() body: unknown) {
    return this.shifts.open(s, validate(OpenInput, body).openingCash);
  }

  @Post('current/close')
  @RequirePermission('sales.create')
  @HttpCode(200)
  close(@CurrentSession() s: PosSession, @Body() body: unknown) {
    return this.shifts.close(s, validate(CloseInput, body).countedCash);
  }

  /** Cash put into or taken out of the actor's open drawer by hand (UMK-1924 U3). */
  @Post('current/cash-entries')
  @RequirePermission('sales.create')
  cashEntry(
    @CurrentSession() s: PosSession,
    @Headers('idempotency-key') key: unknown,
    @Body() body: unknown,
  ) {
    const { idempotencyKey } = validate(
      z.object({ idempotencyKey: IdempotencyKey }),
      { idempotencyKey: key },
    );
    return this.cashEntries.create(
      s,
      idempotencyKey,
      validate(CashEntryInput, body),
    );
  }

  // Before `:id`, or the id route would take it.
  @Get('cash-entry-reasons')
  @RequirePermission('sales.create')
  cashEntryReasons() {
    return this.cashEntries.reasons();
  }

  @Get()
  list(@CurrentSession() s: PosSession, @Query() query: unknown) {
    const q = validate(Page, query);
    return this.shifts.list(s, q.page, q.perPage);
  }

  @Get(':id')
  get(@CurrentSession() s: PosSession, @Param('id') id: string) {
    return this.shifts.get(s, parseId(id));
  }
}
