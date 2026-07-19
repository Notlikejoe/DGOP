import { Controller, Get, Param, Query } from '@nestjs/common';
import { ScoringService } from './scoring.service';
import { CurrentUser, RequirePermissions } from '../auth/decorators';
import { AuthUser } from '../auth/auth.types';

@Controller('ndi/scoring')
export class ScoringController {
  constructor(private readonly service: ScoringService) {}

  @Get('readiness')
  @RequirePermissions('ndi_scoring.view')
  readiness(@CurrentUser() user: AuthUser) {
    return this.service.readiness(user);
  }

  @Get('domains/:domainId')
  @RequirePermissions('ndi_scoring.view')
  domainDetail(@CurrentUser() user: AuthUser, @Param('domainId') domainId: string) {
    return this.service.domainDetail(user, domainId);
  }

  @Get('gaps')
  @RequirePermissions('ndi_scoring.view')
  gaps(@CurrentUser() user: AuthUser, @Query('gapType') gapType?: string, @Query('domainId') domainId?: string) {
    return this.service.gaps(user, { gapType, domainId });
  }
}
