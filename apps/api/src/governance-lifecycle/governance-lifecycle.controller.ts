import { Body, Controller, Get, Post } from '@nestjs/common';
import { CurrentUser, RequirePermissions } from '../auth/decorators';
import { AuthUser } from '../auth/auth.types';
import {
  CreateDecisionRightDto,
  CreateDomainCouncilDto,
  CreateGovernanceCharterDto,
  CreateGovernancePolicyDto,
  CreateImprovementItemDto,
  CreateMaturityAssessmentDto,
} from './governance-lifecycle.dto';
import { GovernanceLifecycleService } from './governance-lifecycle.service';

@Controller('governance-lifecycle')
export class GovernanceLifecycleController {
  constructor(private readonly service: GovernanceLifecycleService) {}

  @Get('workspace')
  @RequirePermissions('governance_operations.view')
  workspace() {
    return this.service.workspace();
  }

  @Post('charters')
  @RequirePermissions('governance_operations.create')
  createCharter(@Body() dto: CreateGovernanceCharterDto, @CurrentUser() user: AuthUser) {
    return this.service.createCharter(dto, user);
  }

  @Post('policies')
  @RequirePermissions('governance_operations.create')
  createPolicy(@Body() dto: CreateGovernancePolicyDto, @CurrentUser() user: AuthUser) {
    return this.service.createPolicy(dto, user);
  }

  @Post('councils')
  @RequirePermissions('governance_operations.create')
  createCouncil(@Body() dto: CreateDomainCouncilDto, @CurrentUser() user: AuthUser) {
    return this.service.createCouncil(dto, user);
  }

  @Post('decision-rights')
  @RequirePermissions('governance_operations.create')
  createDecisionRight(@Body() dto: CreateDecisionRightDto, @CurrentUser() user: AuthUser) {
    return this.service.createDecisionRight(dto, user);
  }

  @Post('maturity-assessments')
  @RequirePermissions('governance_operations.create')
  createMaturityAssessment(@Body() dto: CreateMaturityAssessmentDto, @CurrentUser() user: AuthUser) {
    return this.service.createMaturityAssessment(dto, user);
  }

  @Post('improvements')
  @RequirePermissions('governance_operations.create')
  createImprovement(@Body() dto: CreateImprovementItemDto, @CurrentUser() user: AuthUser) {
    return this.service.createImprovementItem(dto, user);
  }
}
