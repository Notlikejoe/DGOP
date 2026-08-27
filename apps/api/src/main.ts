import 'reflect-metadata';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { config as loadEnv } from 'dotenv';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Logger, ValidationPipe } from '@nestjs/common';
import express from 'express';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import { AppModule } from './app.module';
import { AllExceptionsFilter } from './common/all-exceptions.filter';
import {
  assertSafeRuntimeConfig,
  boundedEnvInteger,
  configuredCorsOrigins,
  configuredListenHost,
  configuredTrustProxy,
  isProductionLikeRuntime,
} from './common/runtime-safety';

const READ_ONLY_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

loadEnv({ path: join(__dirname, '..', '..', '..', '.env') });

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create<NestExpressApplication>(AppModule);
  const logger = new Logger('Bootstrap');
  const listenHost = configuredListenHost();

  app.setGlobalPrefix('api');

  app.useGlobalPipes(
    new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }),
  );

  // Consistent JSON error envelope for every failed request.
  app.useGlobalFilters(new AllExceptionsFilter());

  const instance = app.getHttpAdapter().getInstance();
  // Trust only configured proxy addresses so forwarded client IPs cannot be spoofed.
  instance.set('trust proxy', configuredTrustProxy());

  assertSafeRuntimeConfig();
  const strictConfig = isProductionLikeRuntime();
  const allowedOrigins = configuredCorsOrigins();
  const corsOrigins = allowedOrigins.length ? allowedOrigins : ['http://localhost:4205'];

  app.use(
    helmet({
      contentSecurityPolicy: strictConfig
        ? {
            useDefaults: true,
            directives: {
              defaultSrc: ["'self'"],
              scriptSrc: ["'self'"],
              styleSrc: ["'self'", "'unsafe-inline'"],
              imgSrc: ["'self'", 'data:'],
              fontSrc: ["'self'", 'data:'],
              connectSrc: ["'self'", ...corsOrigins],
              baseUri: ["'self'"],
              formAction: ["'self'"],
              frameAncestors: ["'none'"],
            },
          }
        : false,
    }),
  );
  app.enableCors({ origin: corsOrigins, credentials: true });

  app.use(
    '/api/auth/login',
    rateLimit({
      windowMs: 15 * 60_000,
      max: 20,
      standardHeaders: true,
      legacyHeaders: false,
      skipSuccessfulRequests: true,
    }),
  );

  app.use(
    '/api',
    rateLimit({
      windowMs: 60_000,
      max: 120,
      standardHeaders: true,
      legacyHeaders: false,
      skip: (req) => READ_ONLY_METHODS.has(req.method.toUpperCase()),
    }),
  );

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
    instance.use(express.static(webDir, {
      index: false,
      setHeaders: (res, filePath) => {
        const hashedAsset = /-[A-Za-z0-9_-]{8,}\.(?:css|js)$/.test(filePath);
        res.setHeader('Cache-Control', hashedAsset
          ? 'public, max-age=31536000, immutable'
          : 'no-cache, max-age=0, must-revalidate');
      },
    }));
    // SPA fallback for any non-API GET route.
    instance.get(/^\/(?!api(?:\/|$)).*/, (_req, res) => {
      res.setHeader('Cache-Control', 'no-store, max-age=0');
      res.sendFile(join(webDir, 'index.html'));
    });
    logger.log(`Serving web UI from ${webDir}`);
  } else {
    logger.warn(`Web build not found at ${webDir} (run the web build to serve the UI).`);
  }

  const port = boundedEnvInteger('PORT', 3005, 1, 65535);
  await app.listen(port, listenHost);
  logger.log(`DGOP API listening on http://localhost:${port}/api`);
}

void bootstrap();
