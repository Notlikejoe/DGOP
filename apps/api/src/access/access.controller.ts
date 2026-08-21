import { Body, Controller, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { CurrentUser, RequirePermissions } from '../auth/decorators';
import { AuthUser } from '../auth/auth.types';
import { AccessGrantsService } from './access-grants.service';
import {
  AccessMatrixQueryDto,
  BulkCreateAccessGrantDto,
  CommitAccessGrantImportDto,
  CreateAccessGrantDto,
  CompleteManualAccessEnforcementDto,
  CompleteAccessEnforcementAttemptDto,
  DecideAccessGrantDto,
  DispatchAccessEnforcementDto,
  ListEffectiveAccessDto,
  ListAccessGrantsDto,
  RevokeAccessGrantDto,
  UpdateAccessGrantEnforcementDto,
  UpdateAccessGrantDto,
  ValidateAccessGrantImportDto,
} from './access.dto';

@Controller('access')
export class AccessController {
  constructor(private readonly grants: AccessGrantsService) {}

  @Get('permission-catalog')
  @RequirePermissions('access_grants.view')
  permissionCatalog(@Query('assetType') assetType?: string) {
    return this.grants.listPermissionCatalog(assetType);
  }

  @Get('profiles')
  @RequirePermissions('access_grants.view')
  profiles(@Query('assetType') assetType?: string) {
    return this.grants.listProfiles(assetType);
  }

  @Get('principals')
  @RequirePermissions('access_grants.view')
  principals(@Query('principalType') principalType?: string) {
    return this.grants.listPrincipals(principalType);
  }

  @Get('grants')
  @RequirePermissions('access_grants.view')
  listGrants(@CurrentUser() user: AuthUser, @Query() query: ListAccessGrantsDto) {
    return this.grants.listGrants(user, query);
  }

  @Get('grants/matrix')
  @RequirePermissions('access_grants.view')
  accessMatrix(@CurrentUser() user: AuthUser, @Query() query: AccessMatrixQueryDto) {
    return this.grants.accessMatrix(user, query);
  }

  @Get('effective-access')
  @RequirePermissions('access_grants.view')
  listEffectiveAccess(@CurrentUser() user: AuthUser, @Query() query: ListEffectiveAccessDto) {
    return this.grants.listEffectiveAccess(user, query);
  }

  @Get('reports/summary')
  @RequirePermissions('access_grants.view')
  accessReport(@CurrentUser() user: AuthUser) {
    return this.grants.accessManagementReport(user);
  }

  @Post('grants/lifecycle/reconcile')
  @RequirePermissions('access_grants.edit')
  reconcileLifecycle(@CurrentUser() user: AuthUser) {
    return this.grants.reconcileGrantLifecycle(user);
  }

  @Get('grants/csv/template')
  @RequirePermissions('access_grants.create')
  csvTemplate() {
    return { fileName: 'access-grants-template.csv', csv: this.grants.accessGrantCsvTemplate() };
  }

  @Get('grants/csv/export')
  @RequirePermissions('access_grants.view')
  exportCsv(@CurrentUser() user: AuthUser, @Query() query: ListAccessGrantsDto) {
    return this.grants.exportGrantsCsv(user, query);
  }

  @Post('grants/csv/validate')
  @RequirePermissions('access_grants.create')
  validateCsv(@Body() dto: ValidateAccessGrantImportDto, @CurrentUser() user: AuthUser) {
    return this.grants.validateGrantImport(dto, user);
  }

  @Post('grants/csv/commit')
  @RequirePermissions('access_grants.create')
  commitCsv(@Body() dto: CommitAccessGrantImportDto, @CurrentUser() user: AuthUser) {
    return this.grants.commitGrantImport(dto, user);
  }

  @Post('grants')
  @RequirePermissions('access_grants.create')
  createGrant(@Body() dto: CreateAccessGrantDto, @CurrentUser() user: AuthUser) {
    return this.grants.createGrant(dto, user);
  }

  @Post('grants/bulk')
  @RequirePermissions('access_grants.create')
  createBulkGrants(@Body() dto: BulkCreateAccessGrantDto, @CurrentUser() user: AuthUser) {
    return this.grants.createBulkGrants(dto, user);
  }

  @Get('grants/:id')
  @RequirePermissions('access_grants.view')
  getGrant(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.grants.getGrant(id, user);
  }

  @Patch('grants/:id')
  @RequirePermissions('access_grants.edit')
  updateGrant(@Param('id') id: string, @Body() dto: UpdateAccessGrantDto, @CurrentUser() user: AuthUser) {
    return this.grants.updateGrant(id, dto, user);
  }

  @Patch('grants/:id/decision')
  @RequirePermissions('access_grants.edit')
  decideGrant(@Param('id') id: string, @Body() dto: DecideAccessGrantDto, @CurrentUser() user: AuthUser) {
    return this.grants.decideGrant(id, dto, user);
  }

  @Patch('grants/:id/enforcement')
  @RequirePermissions('access_grants.edit')
  updateEnforcement(
    @Param('id') id: string,
    @Body() dto: UpdateAccessGrantEnforcementDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.grants.updateEnforcement(id, dto, user);
  }

  @Post('grants/:id/enforcement/dispatch')
  @RequirePermissions('access_grants.edit')
  dispatchEnforcement(
    @Param('id') id: string,
    @Body() dto: DispatchAccessEnforcementDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.grants.dispatchEnforcement(id, dto, user);
  }

  @Post('grants/:id/enforcement/manual-complete')
  @RequirePermissions('access_grants.edit')
  completeManualEnforcement(
    @Param('id') id: string,
    @Body() dto: CompleteManualAccessEnforcementDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.grants.completeManualEnforcement(id, dto, user);
  }

  @Post('enforcement/attempts/:attemptId/complete')
  @RequirePermissions('access_grants.edit')
  completeEnforcementAttempt(
    @Param('attemptId') attemptId: string,
    @Body() dto: CompleteAccessEnforcementAttemptDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.grants.completeEnforcementAttempt(attemptId, dto, user);
  }

  @Post('grants/:id/revoke')
  @RequirePermissions('access_grants.edit')
  revokeGrant(@Param('id') id: string, @Body() dto: RevokeAccessGrantDto, @CurrentUser() user: AuthUser) {
    return this.grants.revokeGrant(id, dto, user);
  }
}
