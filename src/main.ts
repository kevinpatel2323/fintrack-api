import 'reflect-metadata';
import { ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import helmet from 'helmet';
import cookieParser from 'cookie-parser';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  // Security headers + cookie parsing (SessionGuard reads req.cookies). Trust
  // the first proxy hop so req.ip / rate-limiting see the real client behind
  // Vercel's edge rather than the proxy address.
  app.use(helmet());
  app.use(cookieParser());
  app.getHttpAdapter().getInstance().set('trust proxy', 1);
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
  if (process.env.AUTH_DISABLED?.trim().toLowerCase() === 'true') {
    // eslint-disable-next-line no-console
    console.warn('AUTH_DISABLED=true — passkey auth is bypassed');
  }
  await app.listen(port);
  // eslint-disable-next-line no-console
  console.log(`Server listening on port ${port}`);
}

bootstrap();
