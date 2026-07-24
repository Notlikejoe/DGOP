import { Body, Controller, Get, Param, Patch, Post } from '@nestjs/common';
import { CurrentUser, RequirePermissions } from '../auth/decorators';
import { AuthUser } from '../auth/auth.types';
import {
  CreateComplianceCalendarTemplateDto,
  CreateGovernanceNotificationDto,
  CreateKsaHolidayDto,
  DispatchNotificationsDto,
  UpdateComplianceCalendarTemplateDto,
  UpdateEscalationDto,
  UpdateNotificationDto,
  UpdateNotificationDeliveryAttemptDto,
  UpsertGovernanceNotificationPreferenceDto,
  UpsertGovernanceNotificationTemplateDto,
} from './governance-operations.dto';
import { GovernanceOperationsService } from './governance-operations.service';

@Controller('governance-operations')
export class GovernanceOperationsController {
  constructor(private readonly service: GovernanceOperationsService) {}

  @Get('workspace')
  @RequirePermissions('governance_operations.view')
  workspace(@CurrentUser() user: AuthUser) {
    return this.service.workspace(user);
  }

  @Get('production-readiness')
  @RequirePermissions('governance_operations.view')
  productionReadiness(@CurrentUser() user: AuthUser) {
    return this.service.productionReadiness(user);
  }

  @Get('operating-model')
  @RequirePermissions('governance_operations.view')
  operatingModel(@CurrentUser() user: AuthUser) {
    return this.service.operatingModel(user);
  }

  @Get('platform-architecture')
  @RequirePermissions('governance_operations.view')
  platformArchitecture(@CurrentUser() user: AuthUser) {
    return this.service.platformArchitecture(user);
  }

  @Get('control-crosswalk')
  @RequirePermissions('governance_operations.view')
  controlCrosswalk(@CurrentUser() user: AuthUser) {
    return this.service.controlCrosswalk(user);
  }

  @Get('production-acceptance')
  @RequirePermissions('governance_operations.view')
  productionAcceptance(@CurrentUser() user: AuthUser) {
    return this.service.productionAcceptancePackage(user);
  }

  @Get('error-experience')
  @RequirePermissions('governance_operations.view')
  errorExperience(@CurrentUser() user: AuthUser) {
    return this.service.errorExperienceReadiness(user);
  }

  @Post('recalculate-sla')
  @RequirePermissions('governance_operations.run')
  recalculateSla(@CurrentUser() user: AuthUser) {
    return this.service.recalculateSla(user);
  }

  @Post('calendar/generate')
  @RequirePermissions('governance_operations.run')
  generateCalendar(@CurrentUser() user: AuthUser) {
    return this.service.generateCalendarOccurrences(user);
  }

  @Post('calendar/templates')
  @RequirePermissions('governance_operations.create')
  createTemplate(@Body() dto: CreateComplianceCalendarTemplateDto, @CurrentUser() user: AuthUser) {
    return this.service.createTemplate(dto, user.email);
  }

  @Patch('calendar/templates/:id')
  @RequirePermissions('governance_operations.edit')
  updateTemplate(@Param('id') id: string, @Body() dto: UpdateComplianceCalendarTemplateDto, @CurrentUser() user: AuthUser) {
    return this.service.updateTemplate(id, dto, user.email);
  }

  @Post('holidays')
  @RequirePermissions('governance_operations.create')
  createHoliday(@Body() dto: CreateKsaHolidayDto, @CurrentUser() user: AuthUser) {
    return this.service.createHoliday(dto, user.email);
  }

  @Get('notifications/digest')
  @RequirePermissions('governance_operations.view')
  notificationDigest(@CurrentUser() user: AuthUser) {
    return this.service.notificationDigest(user);
  }

  @Post('notifications')
  @RequirePermissions('governance_operations.create')
  createNotification(@Body() dto: CreateGovernanceNotificationDto, @CurrentUser() user: AuthUser) {
    return this.service.createNotification(dto, user);
  }

  @Post('notifications/dispatch')
  @RequirePermissions('governance_operations.run')
  dispatchNotifications(@Body() dto: DispatchNotificationsDto, @CurrentUser() user: AuthUser) {
    return this.service.dispatchNotifications(dto, user);
  }

  @Get('notifications/templates')
  @RequirePermissions('governance_operations.view')
  notificationTemplates() {
    return this.service.notificationTemplates();
  }

  @Post('notifications/templates')
  @RequirePermissions('governance_operations.edit')
  upsertNotificationTemplate(@Body() dto: UpsertGovernanceNotificationTemplateDto, @CurrentUser() user: AuthUser) {
    return this.service.upsertNotificationTemplate(dto, user);
  }

  @Get('notifications/preferences')
  @RequirePermissions('governance_operations.view')
  notificationPreferences(@CurrentUser() user: AuthUser) {
    return this.service.notificationPreferences(user);
  }

  @Post('notifications/preferences')
  @RequirePermissions('governance_operations.view')
  upsertNotificationPreference(@Body() dto: UpsertGovernanceNotificationPreferenceDto, @CurrentUser() user: AuthUser) {
    return this.service.upsertNotificationPreference(dto, user);
  }

  @Get('notifications/:id/delivery')
  @RequirePermissions('governance_operations.view')
  notificationDelivery(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.service.notificationDelivery(id, user);
  }

  @Post('notifications/:id/delivery-plan')
  @RequirePermissions('governance_operations.run')
  planNotificationDelivery(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.service.planNotificationDelivery(id, user);
  }

  @Patch('notifications/:id/delivery/:attemptId')
  @RequirePermissions('governance_operations.edit')
  updateNotificationDelivery(
    @Param('id') id: string,
    @Param('attemptId') attemptId: string,
    @Body() dto: UpdateNotificationDeliveryAttemptDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.service.updateNotificationDelivery(id, attemptId, dto, user);
  }

  @Patch('notifications/:id/read')
  @RequirePermissions('governance_operations.view')
  readNotification(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.service.readNotification(id, user);
  }

  @Patch('notifications/:id')
  @RequirePermissions('governance_operations.edit')
  updateNotification(@Param('id') id: string, @Body() dto: UpdateNotificationDto, @CurrentUser() user: AuthUser) {
    return this.service.updateNotification(id, dto, user);
  }

  @Patch('escalations/:id')
  @RequirePermissions('governance_operations.edit')
  updateEscalation(@Param('id') id: string, @Body() dto: UpdateEscalationDto, @CurrentUser() user: AuthUser) {
    return this.service.updateEscalation(id, dto, user);
  }
}
