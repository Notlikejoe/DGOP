import { Controller, Get, Res } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Response } from 'express';
import { PrismaService } from '../prisma/prisma.service';
import { Public } from '../auth/decorators';

@Controller('health')
@Public()
export class HealthController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
  ) {}

  @Get()
  async check(@Res({ passthrough: true }) httpResponse?: Response) {
    const environment = this.config.get<string>('NODE_ENV') ?? 'development';
    const includeDetails =
      environment !== 'production' ||
      this.config.get<string>('HEALTH_INCLUDE_DETAILS') === 'true';
    let dbStatus = 'up';
    try {
      await this.prisma.$queryRaw`SELECT 1`;
    } catch {
      dbStatus = 'down';
      httpResponse?.status(503);
    }

    const response: Record<string, unknown> = {
      status: dbStatus === 'up' ? 'ok' : 'degraded',
      service: 'dgop-api',
      version: '0.1.0',
      timestamp: new Date().toISOString(),
      database: {
        status: dbStatus,
      },
    };
    if (includeDetails) {
      response['environment'] = environment;
      response['uptimeSeconds'] = Math.round(process.uptime());
      response['database'] = {
        ...(response['database'] as Record<string, unknown>),
        name: this.config.get<string>('DB_NAME') ?? 'unknown',
      };
    }
    return response;
  }
}
