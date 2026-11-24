import { Controller, Get, ServiceUnavailableException } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import { Public } from '../auth/service.guard';
import type { Db } from '../db/db.module';
import { InjectDb } from '../db/db.module';

@Controller('health')
export class HealthController {
  constructor(@InjectDb() private readonly db: Db) {}

  @Public()
  @Get()
  async check() {
    try {
      await this.db.execute(sql`select 1`);
    } catch {
      throw new ServiceUnavailableException({
        message: 'Database unavailable',
        code: 'db_unavailable',
      });
    }
    return { status: 'ok' };
  }
}
