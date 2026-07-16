import { Body, Controller, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { CurrentUser, RequirePermissions } from '../auth/decorators';
import { AuthUser } from '../auth/auth.types';
import {
  CreateBreachDto,
  CreateConsentRecordDto,
  CreateDpiaDto,
  CreateDsrRequestDto,
  CreatePrivacyLegalBasisDto,
  CreateRetentionRuleDto,
  CreateRopaRecordDto,
  SavePrivacyGateDto,
  UpdateBreachDto,
  UpdateDpiaDto,
  UpdateDsrRequestDto,
} from './privacy.dto';
import { PrivacyFilters, PrivacyService } from './privacy.service';

@Controller('privacy')
export class PrivacyController {
  constructor(private readonly service: PrivacyService) {}

  @Get('summary')
  @RequirePermissions('privacy_operations.view')
  summary(@CurrentUser() user: AuthUser) {
    return this.service.summary(user.roles);
  }

  @Get('legal-bases')
  @RequirePermissions('privacy_operations.view')
  legalBases() {
    return this.service.legalBases();
  }

  @Post('legal-bases')
  @RequirePermissions('privacy_operations.create')
  createLegalBasis(@Body() dto: CreatePrivacyLegalBasisDto, @CurrentUser() user: AuthUser) {
    return this.service.createLegalBasis(dto, user.email);
  }

  @Get('ropa')
  @RequirePermissions('privacy_operations.view')
  listRopa(@CurrentUser() user: AuthUser, @Query('search') search?: string, @Query('status') status?: string, @Query('page') page?: string, @Query('pageSize') pageSize?: string) {
    const filters: PrivacyFilters = { search, status, page: page ?? '1', pageSize: pageSize ?? '25' };
    return this.service.listRopa(user.roles, filters);
  }

  @Post('ropa')
  @RequirePermissions('privacy_operations.create')
  createRopa(@Body() dto: CreateRopaRecordDto, @CurrentUser() user: AuthUser) {
    return this.service.createRopa(user.roles, dto, user.email);
  }

  @Get('dpia')
  @RequirePermissions('privacy_operations.view')
  listDpias(@CurrentUser() user: AuthUser, @Query('search') search?: string, @Query('status') status?: string, @Query('page') page?: string, @Query('pageSize') pageSize?: string) {
    const filters: PrivacyFilters = { search, status, page: page ?? '1', pageSize: pageSize ?? '25' };
    return this.service.listDpias(user.roles, filters);
  }

  @Get('dpia/:id')
  @RequirePermissions('privacy_operations.view')
  getDpia(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.service.getDpia(user.roles, id);
  }

  @Post('dpia')
  @RequirePermissions('privacy_operations.create')
  createDpia(@Body() dto: CreateDpiaDto, @CurrentUser() user: AuthUser) {
    return this.service.createDpia(user.roles, dto, user.email);
  }

  @Patch('dpia/:id')
  @RequirePermissions('privacy_operations.edit')
  updateDpia(@Param('id') id: string, @Body() dto: UpdateDpiaDto, @CurrentUser() user: AuthUser) {
    return this.service.updateDpia(user.roles, id, dto, user.email);
  }

  @Post('dpia/:id/gates')
  @RequirePermissions('privacy_operations.edit')
  saveGate(@Param('id') id: string, @Body() dto: SavePrivacyGateDto, @CurrentUser() user: AuthUser) {
    return this.service.saveGate(user.roles, id, dto, user.email);
  }

  @Get('dsr')
  @RequirePermissions('privacy_operations.view')
  listDsr(@CurrentUser() user: AuthUser, @Query('search') search?: string, @Query('status') status?: string, @Query('page') page?: string, @Query('pageSize') pageSize?: string) {
    const filters: PrivacyFilters = { search, status, page: page ?? '1', pageSize: pageSize ?? '25' };
    return this.service.listDsr(user.roles, filters);
  }

  @Post('dsr')
  @RequirePermissions('privacy_operations.create')
  createDsr(@Body() dto: CreateDsrRequestDto, @CurrentUser() user: AuthUser) {
    return this.service.createDsr(user.roles, dto, user.email);
  }

  @Patch('dsr/:id')
  @RequirePermissions('privacy_operations.edit')
  updateDsr(@Param('id') id: string, @Body() dto: UpdateDsrRequestDto, @CurrentUser() user: AuthUser) {
    return this.service.updateDsr(user.roles, id, dto, user.email);
  }

  @Get('breaches')
  @RequirePermissions('privacy_operations.view')
  listBreaches(@CurrentUser() user: AuthUser, @Query('search') search?: string, @Query('status') status?: string, @Query('page') page?: string, @Query('pageSize') pageSize?: string) {
    const filters: PrivacyFilters = { search, status, page: page ?? '1', pageSize: pageSize ?? '25' };
    return this.service.listBreaches(user.roles, filters);
  }

  @Post('breaches')
  @RequirePermissions('privacy_operations.create')
  createBreach(@Body() dto: CreateBreachDto, @CurrentUser() user: AuthUser) {
    return this.service.createBreach(user.roles, dto, user.email);
  }

  @Patch('breaches/:id')
  @RequirePermissions('privacy_operations.edit')
  updateBreach(@Param('id') id: string, @Body() dto: UpdateBreachDto, @CurrentUser() user: AuthUser) {
    return this.service.updateBreach(user.roles, id, dto, user.email);
  }

  @Post('consents')
  @RequirePermissions('privacy_operations.create')
  createConsent(@Body() dto: CreateConsentRecordDto, @CurrentUser() user: AuthUser) {
    return this.service.createConsent(user.roles, dto, user.email);
  }

  @Post('retention-rules')
  @RequirePermissions('privacy_operations.create')
  createRetentionRule(@Body() dto: CreateRetentionRuleDto, @CurrentUser() user: AuthUser) {
    return this.service.createRetentionRule(user.roles, dto, user.email);
  }
}
