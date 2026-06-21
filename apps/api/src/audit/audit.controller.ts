import { Controller, Get, Query } from '@nestjs/common';
import { AuditService, AuditFilters } from './audit.service';
import { RequirePermissions } from '../auth/decorators';

@Controller('audit')
export class AuditController {
  constructor(private readonly service: AuditService) {}

  @Get('facets')
  @RequirePermissions('audit.view')
  facets() {
    return this.service.facets();
  }

  @Get()
  @RequirePermissions('audit.view')
  list(
    @Query('actor') actor?: string,
    @Query('action') action?: string,
    @Query('entityType') entityType?: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
  ) {
    const filters: AuditFilters = { actor, action, entityType, from, to };
    return this.service.list(filters, page, pageSize);
  }
}
