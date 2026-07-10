import { Body, Controller, Get, Param, Patch, Post } from '@nestjs/common';
import { CurrentUser, RequirePermissions } from '../auth/decorators';
import { AuthUser } from '../auth/auth.types';
import {
  CreateAccessReviewDto,
  CreateClassificationChangeRequestDto,
  CreateDlpIncidentDto,
  CreateMaskingPolicyDto,
  CreateRoleDataAccessMapDto,
  SimulateAccessDecisionDto,
  UpdateAccessReviewItemDto,
} from './security-governance.dto';
import { SecurityGovernanceService } from './security-governance.service';

@Controller('security-governance')
export class SecurityGovernanceController {
  constructor(private readonly service: SecurityGovernanceService) {}

  @Get('summary')
  @RequirePermissions('security_governance.view')
  summary(@CurrentUser() user: AuthUser) {
    return this.service.summary(user.roles);
  }

  @Get('access-map')
  @RequirePermissions('security_governance.view')
  accessMap(@CurrentUser() user: AuthUser) {
    return this.service.accessMap(user.roles);
  }

  @Post('access-map')
  @RequirePermissions('security_governance.edit')
  upsertAccessMap(@Body() dto: CreateRoleDataAccessMapDto, @CurrentUser() user: AuthUser) {
    return this.service.upsertAccessMap(user.roles, dto, user.email);
  }

  @Get('masking-policies')
  @RequirePermissions('security_governance.view')
  maskingPolicies(@CurrentUser() user: AuthUser) {
    return this.service.maskingPolicies(user.roles);
  }

  @Post('masking-policies')
  @RequirePermissions('security_governance.create')
  createMaskingPolicy(@Body() dto: CreateMaskingPolicyDto, @CurrentUser() user: AuthUser) {
    return this.service.createMaskingPolicy(user.roles, dto, user.email);
  }

  @Get('access-reviews')
  @RequirePermissions('security_governance.view')
  accessReviews(@CurrentUser() user: AuthUser) {
    return this.service.accessReviews(user.roles);
  }

  @Post('access-reviews')
  @RequirePermissions('security_governance.create')
  createAccessReview(@Body() dto: CreateAccessReviewDto, @CurrentUser() user: AuthUser) {
    return this.service.createAccessReview(user.roles, dto, user.email);
  }

  @Patch('access-review-items/:id')
  @RequirePermissions('security_governance.edit')
  updateReviewItem(@Param('id') id: string, @Body() dto: UpdateAccessReviewItemDto, @CurrentUser() user: AuthUser) {
    return this.service.updateReviewItem(id, user.roles, dto, user.email);
  }

  @Get('dlp-incidents')
  @RequirePermissions('security_governance.view')
  dlpIncidents(@CurrentUser() user: AuthUser) {
    return this.service.dlpIncidents(user.roles);
  }

  @Post('dlp-incidents')
  @RequirePermissions('security_governance.create')
  createDlpIncident(@Body() dto: CreateDlpIncidentDto, @CurrentUser() user: AuthUser) {
    return this.service.createDlpIncident(user.roles, dto, user.email);
  }

  @Get('classification-requests')
  @RequirePermissions('security_governance.view')
  classificationRequests(@CurrentUser() user: AuthUser) {
    return this.service.classificationRequests(user.roles);
  }

  @Post('classification-requests')
  @RequirePermissions('security_governance.create')
  createClassificationRequest(@Body() dto: CreateClassificationChangeRequestDto, @CurrentUser() user: AuthUser) {
    return this.service.createClassificationRequest(user.roles, dto, user.email);
  }

  @Get('decision-log')
  @RequirePermissions('security_governance.view')
  decisionLog(@CurrentUser() user: AuthUser) {
    return this.service.decisionLog(user.roles);
  }

  @Post('decision-log/simulate')
  @RequirePermissions('security_governance.create')
  simulateDecision(@Body() dto: SimulateAccessDecisionDto, @CurrentUser() user: AuthUser) {
    return this.service.simulateDecision(user.roles, dto, user.email);
  }
}
