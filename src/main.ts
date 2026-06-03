import 'reflect-metadata';
import { ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  // Drain the TypeORM connection pool on SIGTERM/SIGINT so every restart
  // (nest --watch recompiles, production redeploys) releases its connections
  // back to the Supabase pooler instead of leaking them toward the shared
  // 200-client ceiling. Without this, leaked connections accumulate until the
  // pooler refuses new ones and the app starts timing out.
  app.enableShutdownHooks();
  app.enableCors({
    origin: process.env.CORS_ORIGIN ? process.env.CORS_ORIGIN.split(',') : true,
  });
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      transform: true,
      forbidNonWhitelisted: true,
    }),
  );

  const port = Number(process.env.PORT || 3000);
  await app.listen(port);
  // eslint-disable-next-line no-console
  console.log(`Server listening on port ${port}`);
}

bootstrap();
