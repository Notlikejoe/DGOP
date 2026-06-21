import { Controller, Get, Param, Query } from '@nestjs/common';
import { ScoringService } from './scoring.service';
import { GapType } from './scoring.logic';
import { RequirePermissions } from '../auth/decorators';

@Controller('ndi/scoring')
export class ScoringController {
  constructor(private readonly service: ScoringService) {}

  @Get('readiness')
  @RequirePermissions('ndi_scoring.view')
  readiness() {
    return this.service.readiness();
  }

  @Get('domains/:domainId')
  @RequirePermissions('ndi_scoring.view')
  domainDetail(@Param('domainId') domainId: string) {
    return this.service.domainDetail(domainId);
  }

  @Get('gaps')
  @RequirePermissions('ndi_scoring.view')
  gaps(@Query('gapType') gapType?: GapType, @Query('domainId') domainId?: string) {
    return this.service.gaps({ gapType, domainId });
  }
}
