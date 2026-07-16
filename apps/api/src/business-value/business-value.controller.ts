import { Body, Controller, Get, Param, Patch, Post } from '@nestjs/common';
import { CurrentUser, RequirePermissions } from '../auth/decorators';
import { AuthUser } from '../auth/auth.types';
import {
  CreateBusinessImpactAssessmentDto,
  CreateBusinessLineageDto,
  CreateDataAssetValuationDto,
  CreateDataUserSurveyDto,
  CreateDataValueKpiDto,
  CreateGlossaryTermDto,
  CreateLifecycleDecisionDto,
  DecideGlossaryTermDto,
  DecideLifecycleDecisionDto,
  UpdateBusinessLineageDto,
} from './business-value.dto';
import { BusinessValueService } from './business-value.service';

@Controller('business-value')
export class BusinessValueController {
  constructor(private readonly service: BusinessValueService) {}

  @Get('workspace')
  @RequirePermissions('business_value.view')
  workspace(@CurrentUser() user: AuthUser) {
    return this.service.workspace(user.roles);
  }

  @Post('glossary')
  @RequirePermissions('business_value.create')
  createGlossary(@Body() dto: CreateGlossaryTermDto, @CurrentUser() user: AuthUser) {
    return this.service.createGlossaryTerm(user.roles, dto, user.email);
  }

  @Patch('glossary/:id')
  @RequirePermissions('business_value.edit')
  decideGlossary(@Param('id') id: string, @Body() dto: DecideGlossaryTermDto, @CurrentUser() user: AuthUser) {
    return this.service.decideGlossaryTerm(user.roles, id, dto, user.email);
  }

  @Post('lineage')
  @RequirePermissions('business_value.create')
  createLineage(@Body() dto: CreateBusinessLineageDto, @CurrentUser() user: AuthUser) {
    return this.service.createLineage(user.roles, dto, user.email);
  }

  @Patch('lineage/:id')
  @RequirePermissions('business_value.edit')
  updateLineage(@Param('id') id: string, @Body() dto: UpdateBusinessLineageDto, @CurrentUser() user: AuthUser) {
    return this.service.updateLineage(user.roles, id, dto, user.email);
  }

  @Post('valuations')
  @RequirePermissions('business_value.create')
  createValuation(@Body() dto: CreateDataAssetValuationDto, @CurrentUser() user: AuthUser) {
    return this.service.createValuation(user.roles, dto, user.email);
  }

  @Post('surveys')
  @RequirePermissions('business_value.create')
  createSurvey(@Body() dto: CreateDataUserSurveyDto, @CurrentUser() user: AuthUser) {
    return this.service.createSurvey(user.roles, dto, user.email);
  }

  @Post('lifecycle')
  @RequirePermissions('business_value.create')
  createLifecycle(@Body() dto: CreateLifecycleDecisionDto, @CurrentUser() user: AuthUser) {
    return this.service.createLifecycleDecision(user.roles, dto, user.email);
  }

  @Patch('lifecycle/:id')
  @RequirePermissions('business_value.edit')
  decideLifecycle(@Param('id') id: string, @Body() dto: DecideLifecycleDecisionDto, @CurrentUser() user: AuthUser) {
    return this.service.decideLifecycle(user.roles, id, dto, user.email);
  }

  @Post('bia')
  @RequirePermissions('business_value.create')
  createBia(@Body() dto: CreateBusinessImpactAssessmentDto, @CurrentUser() user: AuthUser) {
    return this.service.createBia(user.roles, dto, user.email);
  }

  @Post('kpis')
  @RequirePermissions('business_value.create')
  createKpi(@Body() dto: CreateDataValueKpiDto, @CurrentUser() user: AuthUser) {
    return this.service.createKpi(user.roles, dto, user.email);
  }
}
