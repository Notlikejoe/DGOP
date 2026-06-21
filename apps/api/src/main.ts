import 'reflect-metadata';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Logger, ValidationPipe } from '@nestjs/common';
import express from 'express';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import { AppModule } from './app.module';
import { AllExceptionsFilter } from './common/all-exceptions.filter';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create<NestExpressApplication>(AppModule);
  const logger = new Logger('Bootstrap');

  app.setGlobalPrefix('api');

  app.useGlobalPipes(
    new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }),
  );

  // Consistent JSON error envelope for every failed request.
  app.useGlobalFilters(new AllExceptionsFilter());

  const instance = app.getHttpAdapter().getInstance();
  // Required so rate limiting and client IPs work behind the tunnel/proxy.
  instance.set('trust proxy', 1);

  // Security headers. CSP is disabled in Sprint 0 (external fonts + inline styles);
  // a strict CSP is introduced in the security-hardening sprint.
  app.use(helmet({ contentSecurityPolicy: false }));

  const origins = (process.env.CORS_ORIGINS ?? '')
    .split(',')
    .map((o) => o.trim())
    .filter(Boolean);
  if (process.env.PUBLIC_ORIGIN) origins.push(process.env.PUBLIC_ORIGIN);
  app.enableCors({ origin: origins.length ? origins : true, credentials: true });

  app.use(
    '/api',
    rateLimit({
      windowMs: 60_000,
      max: 300,
      standardHeaders: true,
      legacyHeaders: false,
    }),
  );

  // Serve the built Angular SPA (if present) from the same origin as the API.
  const webDir = join(__dirname, '..', '..', 'web', 'dist', 'web', 'browser');
  if (existsSync(webDir)) {
    instance.use(express.static(webDir, { index: false }));
    // SPA fallback for any non-API GET route.
    instance.get(/^\/(?!api(?:\/|$)).*/, (_req, res) => {
      res.sendFile(join(webDir, 'index.html'));
    });
    logger.log(`Serving web UI from ${webDir}`);
  } else {
    logger.warn(`Web build not found at ${webDir} (run the web build to serve the UI).`);
  }

  const port = Number(process.env.PORT ?? 3005);
  await app.listen(port, '0.0.0.0');
  logger.log(`DGOP API listening on http://localhost:${port}/api`);
}

void bootstrap();
