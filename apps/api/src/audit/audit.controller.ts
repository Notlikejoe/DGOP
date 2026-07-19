import { Controller, Get, Post, Query } from '@nestjs/common';
import { AuditService, AuditFilters } from './audit.service';
import { CurrentUser, RequirePermissions, Roles } from '../auth/decorators';
import { AuthUser } from '../auth/auth.types';

@Controller('audit')
export class AuditController {
  constructor(private readonly service: AuditService) {}

  @Get('facets')
  @RequirePermissions('audit.view')
  facets() {
    return this.service.facets();
  }

  @Get('chain/verify')
  @RequirePermissions('audit.view')
  verifyChain(@Query('limit') limit?: string) {
    return this.service.verifyChain(limit);
  }

  @Post('chain/accept-legacy-baseline')
  @Roles('system_admin', 'dmo_admin')
  @RequirePermissions('audit.baseline_accept')
  acceptLegacyBaseline(@CurrentUser() user: AuthUser, @Query('limit') limit?: string) {
    return this.service.acceptLegacyBaseline(user.email, limit);
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
