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
import { AgentRoute, CurrentSession, HelperRoute } from '../tenancy/decorators';
import type { PosSession } from '../tenancy/session';
import {
  CashEntriesService,
  CashEntryInput,
  recordOwnerTakeAtClose,
} from './cash-entries.service';
import { ShiftsService } from './shifts.service';

const cash = z.number().int().nonnegative().max(1_000_000_000_000);
const OpenInput = z.object({ openingCash: cash }).strict();
// UMK-2122: `ownerTakes`, the cash the owner takes from the counted drawer at "Tutup hari" (owner only), and
// `shiftId`, the shift the screen counted (required with a take): a close of another shift answers 409.
const CloseInput = z
  .object({
    countedCash: cash,
    ownerTakes: cash.optional(),
    shiftId: z.string().uuid('Shift tidak dikenal').optional(),
  })
  .strict()
  .refine((i) => !i.ownerTakes || i.shiftId !== undefined, {
    path: ['shiftId'],
    message: 'Shift yang ditutup wajib disebut',
  });
const OpeningInput = z
  .object({
    shiftId: z.string().uuid('Shift tidak dikenal'),
    openingCash: cash.optional(),
  })
  .strict();

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

  @AgentRoute()
  @HelperRoute()
  @Get('current')
  @RequirePermission('sales.create')
  async current(@CurrentSession() s: PosSession) {
    // UMK-2124 (review of PR 109): a helper sells into the owner's shift but sees none of its money (revenue,
    // profit, cost, the drawer ledger): only that a shift is open.
    if (s.kind === 'helper') {
      const open = await this.shifts.current(s);
      return {
        shift: open ? { id: open.id, openedAt: open.openedAt } : null,
        autoOpen: false,
        discountPinRequired: true,
      };
    }
    const shift = await this.shifts.current(s);
    // UMK-2120: no shift, but the owner's next cash action opens one (a store without staff).
    return {
      shift,
      autoOpen: await this.shifts.autoOpens(s, shift !== null),
      // UMK-2123: false for a solo owner, whose own reductions above 30% need no PIN.
      discountPinRequired: await this.shifts.discountPinRequired(s),
    };
  }

  @AgentRoute()
  @Post('open')
  @RequirePermission('sales.create')
  open(@CurrentSession() s: PosSession, @Body() body: unknown) {
    return this.shifts.open(s, validate(OpenInput, body).openingCash);
  }

  @Post('current/close')
  @RequirePermission('sales.create')
  @HttpCode(200)
  close(@CurrentSession() s: PosSession, @Body() body: unknown) {
    const input = validate(CloseInput, body);
    return this.shifts.close(
      s,
      input.countedCash,
      input.ownerTakes ?? 0,
      recordOwnerTakeAtClose,
      input.shiftId,
    );
  }

  /** Design 40 screen 7: the owner checks, or corrects once, an automatically opened shift's opening cash. */
  @Post('current/opening')
  @RequirePermission('sales.create')
  @HttpCode(200)
  checkOpening(@CurrentSession() s: PosSession, @Body() body: unknown) {
    const input = validate(OpeningInput, body);
    return this.shifts.checkOpening(s, input.shiftId, input.openingCash);
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
