import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { AppModule } from './app.module';
import { loadEnv } from './config';
import { configureBody } from './http';

async function bootstrap() {
  const env = loadEnv();
  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    bodyParser: false,
  });
  configureBody(app);
  app.set('trust proxy', env.POS_TRUSTED_PROXIES);
  app.enableShutdownHooks();
  await app.listen(env.PORT);
}
void bootstrap();
