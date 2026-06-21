import { Controller, Get } from '@nestjs/common';
import { DashboardService } from './dashboard.service';
import { CurrentUser, RequirePermissions } from '../auth/decorators';
import { AuthUser } from '../auth/auth.types';

@Controller('dashboard')
export class DashboardController {
  constructor(private readonly service: DashboardService) {}

  @Get('stats')
  @RequirePermissions('dashboard.view')
  stats(@CurrentUser() user: AuthUser) {
    return this.service.stats(user.roles, user.id);
  }

  @Get('summary')
  @RequirePermissions('dashboard.view')
  summary(@CurrentUser() user: AuthUser) {
    return this.service.summary(user);
  }
}
