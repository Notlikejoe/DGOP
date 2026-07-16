import { Controller, Get, Param, Query, Res } from '@nestjs/common';
import type { Response } from 'express';
import { CurrentUser, RequirePermissions } from '../auth/decorators';
import { AuthUser } from '../auth/auth.types';
import { ReportsService, type ReportFilters } from './reports.service';
import type { ReportFormat } from './reports.logic';

@Controller('reports')
export class ReportsController {
  constructor(private readonly service: ReportsService) {}

  @Get()
  @RequirePermissions('dashboard.view')
  catalog(@CurrentUser() user: AuthUser) {
    return this.service.catalog(user);
  }

  @Get(':id')
  @RequirePermissions('dashboard.view')
  run(
    @Param('id') id: string,
    @CurrentUser() user: AuthUser,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('status') status?: string,
    @Query('domainId') domainId?: string,
  ) {
    return this.service.run(user, id, { from, to, status, domainId });
  }

  @Get(':id/export/:format')
  @RequirePermissions('dashboard.view')
  async export(
    @Param('id') id: string,
    @Param('format') format: ReportFormat,
    @CurrentUser() user: AuthUser,
    @Res() res: Response,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('status') status?: string,
    @Query('domainId') domainId?: string,
  ) {
    const filters: ReportFilters = { from, to, status, domainId };
    const file = await this.service.export(user, id, format, filters);
    res.setHeader('Content-Type', file.contentType);
    res.setHeader('Content-Disposition', `attachment; filename="${file.filename}"`);
    res.send(file.body);
  }
}
