import { Controller, Get } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
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
  async check() {
    const environment = this.config.get<string>('NODE_ENV') ?? 'development';
    const includeDetails =
      environment !== 'production' ||
      this.config.get<string>('HEALTH_INCLUDE_DETAILS') === 'true';
    let dbStatus = 'up';
    try {
      await this.prisma.$queryRaw`SELECT 1`;
    } catch {
      dbStatus = 'down';
    }

    const response: Record<string, unknown> = {
      status: dbStatus === 'up' ? 'ok' : 'degraded',
      service: 'dgop-api',
      version: '0.1.0',
      timestamp: new Date().toISOString(),
    };
    if (includeDetails) {
      response['environment'] = environment;
      response['uptimeSeconds'] = Math.round(process.uptime());
      response['database'] = {
        status: dbStatus,
        name: this.config.get<string>('DB_NAME') ?? 'unknown',
      };
    }
    return response;
  }
}
