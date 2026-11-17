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
import { parse } from '../catalog/catalog.schemas';
import { parseId } from '../staff/http';
import { RequirePermission } from '../staff/require-permission';
import { CurrentSession } from '../tenancy/decorators';
import type { PosSession } from '../tenancy/session';
import {
  OrderCreate,
  OrderUpdate,
  PurchasingService,
} from './purchasing.service';

@Controller('purchasing/orders')
export class PurchasingController {
  constructor(private readonly orders: PurchasingService) {}

  @Get()
  async list(@CurrentSession() s: PosSession) {
    return { data: await this.orders.list(s.tenantId) };
  }

  @Post()
  @RequirePermission('purchasing.manage')
  create(@CurrentSession() s: PosSession, @Body() body: unknown) {
    return this.orders.create(s.tenantId, s.actorId, parse(OrderCreate, body));
  }

  @Get(':id')
  get(@CurrentSession() s: PosSession, @Param('id') id: string) {
    return this.orders.get(s.tenantId, parseId(id));
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
      parse(OrderUpdate, body),
    );
  }

  @Delete(':id')
  @RequirePermission('purchasing.manage')
  @HttpCode(204)
  async remove(@CurrentSession() s: PosSession, @Param('id') id: string) {
    await this.orders.remove(s.tenantId, parseId(id));
  }

  @Post(':id/cancel')
  @RequirePermission('purchasing.manage')
  @HttpCode(200)
  cancel(@CurrentSession() s: PosSession, @Param('id') id: string) {
    return this.orders.cancel(s.tenantId, parseId(id));
  }
}

@Module({
  controllers: [PurchasingController],
  providers: [PurchasingService],
})
export class PurchasingModule {}
