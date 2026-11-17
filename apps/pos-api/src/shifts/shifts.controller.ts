import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  Post,
  Query,
} from '@nestjs/common';
import { z } from 'zod';
import { validate } from '../common/validation';
import { parseId } from '../staff/http';
import { RequirePermission } from '../staff/require-permission';
import { CurrentSession } from '../tenancy/decorators';
import type { PosSession } from '../tenancy/session';
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
  constructor(private readonly shifts: ShiftsService) {}

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
