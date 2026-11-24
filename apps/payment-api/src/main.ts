import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { loadEnv } from './config';

async function bootstrap() {
  const env = loadEnv();
  // rawBody: a webhook's signature is checked over the exact bytes the PG sent.
  const app = await NestFactory.create(AppModule, { rawBody: true });
  app.enableShutdownHooks();
  await app.listen(env.PORT);
}
void bootstrap();
