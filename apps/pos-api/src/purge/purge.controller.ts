import {
  Body,
  Controller,
  Headers,
  HttpCode,
  HttpException,
  Logger,
  Module,
  Post,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { createHash, timingSafeEqual } from 'node:crypto';
import { z } from 'zod';
import { LocalDiskStorage, OBJECT_STORAGE } from '../catalog/storage';
import { UuidField, validate } from '../common/validation';
import { loadEnv } from '../config';
import { Public } from '../tenancy/decorators';
import { PurgeService } from './purge.service';

const PurgeBody = z.object({ userId: UuidField });
const digest = (s: string) => createHash('sha256').update(s).digest();

/** UMKMall → POS, server to server, when an account is erased (UMK-1924 U8; caller: UMKMall u8a). */
@Controller('internal/tenants')
export class PurgeController {
  private readonly logger = new Logger(PurgeController.name);
  private readonly serviceKey = digest(loadEnv().POS_SERVICE_KEY);

  constructor(private readonly purge: PurgeService) {}

  @Public() // no POS session: authenticated by the shared service key instead
  @Post('purge')
  @HttpCode(200)
  async purgeTenant(
    @Headers('x-pos-service-key') key: string | undefined,
    @Body() body: unknown,
  ) {
    if (!key || !timingSafeEqual(digest(key), this.serviceKey))
      throw new UnauthorizedException({ message: 'Kunci layanan tidak valid' });
    const { userId } = validate(PurgeBody, body);
    try {
      return { purged: await this.purge.purge(userId) };
    } catch (error) {
      if (error instanceof HttpException) throw error; // 409: account not being deleted
      // Error class only. Nothing was committed if the images could not go, so UMKMall's retry completes it.
      this.logger.error(`purge failed: ${(error as Error).name}`);
      throw new ServiceUnavailableException();
    }
  }
}

@Module({
  controllers: [PurgeController],
  providers: [
    PurgeService,
    {
      provide: OBJECT_STORAGE,
      useFactory: () => new LocalDiskStorage(loadEnv().POS_STORAGE_DIR),
    },
  ],
})
export class PurgeModule {}
