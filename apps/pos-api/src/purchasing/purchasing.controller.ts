import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Module,
  Param,
  Patch,
  Post,
} from '@nestjs/common';
import { validate } from '../common/validation';
import { StockModule } from '../stock/stock.module';
import { parseId } from '../staff/http';
import { hasPermission, RequirePermission } from '../staff/require-permission';
import { AgentRoute, CurrentSession } from '../tenancy/decorators';
import type { PosSession } from '../tenancy/session';
import {
  OrderCreate,
  OrderUpdate,
  PurchasingService,
} from './purchasing.service';

/** Purchase costs are for `purchasing.manage` or `reports.view` (like sale cost); others see the rest. */
const seesCost = (s: PosSession) =>
  hasPermission(s, 'purchasing.manage') || hasPermission(s, 'reports.view');

@Controller('purchasing/orders')
export class PurchasingController {
  constructor(private readonly orders: PurchasingService) {}

  @Get()
  async list(@CurrentSession() s: PosSession) {
    const rows = await this.orders.list(s.tenantId);
    return {
      data: seesCost(s) ? rows : rows.map((r) => ({ ...r, total: undefined })),
    };
  }

  @AgentRoute()
  @Post()
  @RequirePermission('purchasing.manage')
  create(@CurrentSession() s: PosSession, @Body() body: unknown) {
    return this.orders.create(
      s.tenantId,
      s.actorId,
      validate(OrderCreate, body),
    );
  }

  @Get(':id')
  async get(@CurrentSession() s: PosSession, @Param('id') id: string) {
    const order = await this.orders.get(s.tenantId, parseId(id));
    if (seesCost(s)) return order;
    return {
      ...order,
      total: undefined,
      lines: order.lines.map((l) => ({ ...l, unitCost: undefined })),
    };
  }

  @Patch(':id')
  @RequirePermission('purchasing.manage')
  update(
    @CurrentSession() s: PosSession,
    @Param('id') id: string,
    @Body() body: unknown,
  ) {
    return this.orders.update(
      s.tenantId,
      parseId(id),
      validate(OrderUpdate, body),
    );
  }

  @Delete(':id')
  @RequirePermission('purchasing.manage')
  @HttpCode(204)
  async remove(@CurrentSession() s: PosSession, @Param('id') id: string) {
    await this.orders.remove(s.tenantId, parseId(id));
  }

  @AgentRoute()
  @Post(':id/approve')
  @RequirePermission('purchasing.manage')
  @HttpCode(200)
  approve(@CurrentSession() s: PosSession, @Param('id') id: string) {
    return this.orders.approve(s.tenantId, s.actorId, parseId(id));
  }

  @Post(':id/cancel')
  @RequirePermission('purchasing.manage')
  @HttpCode(200)
  cancel(@CurrentSession() s: PosSession, @Param('id') id: string) {
    return this.orders.cancel(s.tenantId, parseId(id));
  }
}

@Module({
  imports: [StockModule],
  controllers: [PurchasingController],
  providers: [PurchasingService],
})
export class PurchasingModule {}
