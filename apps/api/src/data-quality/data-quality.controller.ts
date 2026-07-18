import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
  BadRequestException,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { CurrentUser, RequirePermissions } from '../auth/decorators';
import { AuthUser } from '../auth/auth.types';
import { DataQualityService } from './data-quality.service';
import {
  CloseDataQualityIssueDto,
  CreateDataQualityIssueDto,
  CreateDataQualityRuleDto,
  DataQualityRuleTransitionDto,
  ImportDataQualityProfileDto,
  ImportDataQualityIssuesDto,
  UpdateDataQualityIssueDto,
  UpdateDataQualityRuleDto,
  UpsertDataQualityRcaDto,
} from './data-quality.dto';
import {
  DATA_QUALITY_IMPORT_API_MESSAGES,
  DATA_QUALITY_IMPORT_MAX_FILE_SIZE_BYTES,
  dataQualityPageConfig,
  isAcceptedDataQualityImportFile,
} from './data-quality.config';

@Controller('data-quality')
export class DataQualityController {
  constructor(private readonly service: DataQualityService) {}

  @Get('config')
  @RequirePermissions('data_quality_issues.view')
  config() {
    return dataQualityPageConfig();
  }

  @Get('summary')
  @RequirePermissions('data_quality_issues.view')
  summary(@CurrentUser() user: AuthUser) {
    return this.service.summary(user.roles);
  }

  @Get('scorecard')
  @RequirePermissions('data_quality_issues.view')
  scorecard(@CurrentUser() user: AuthUser) {
    return this.service.scorecard(user.roles);
  }

  @Post('sla/refresh')
  @RequirePermissions('data_quality_issues.edit')
  refreshSla(@CurrentUser() user: AuthUser) {
    return this.service.refreshSlaBreachMarkers(user.roles);
  }

  @Get('rules')
  @RequirePermissions('data_quality_rules.view')
  rules(
    @CurrentUser() user: AuthUser,
    @Query('search') search?: string,
    @Query('status') status?: string,
    @Query('dimension') dimension?: string,
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
  ) {
    return this.service.listRules(user.roles, { search, status, dimension }, page, pageSize);
  }

  @Post('rules')
  @RequirePermissions('data_quality_rules.create')
  createRule(@Body() dto: CreateDataQualityRuleDto, @CurrentUser() user: AuthUser) {
    return this.service.createRule(user.roles, dto, user.email);
  }

  @Patch('rules/:id')
  @RequirePermissions('data_quality_rules.edit')
  updateRule(@Param('id') id: string, @Body() dto: UpdateDataQualityRuleDto, @CurrentUser() user: AuthUser) {
    return this.service.updateRule(id, user.roles, dto, user.email);
  }

  @Post('rules/:id/submit')
  @RequirePermissions('data_quality_rules.edit')
  submitRule(@Param('id') id: string, @Body() dto: DataQualityRuleTransitionDto, @CurrentUser() user: AuthUser) {
    return this.service.transitionRule(id, user.roles, 'submit', dto, user.email);
  }

  @Post('rules/:id/approve')
  @RequirePermissions('data_quality_rules.edit')
  approveRule(@Param('id') id: string, @Body() dto: DataQualityRuleTransitionDto, @CurrentUser() user: AuthUser) {
    return this.service.transitionRule(id, user.roles, 'approve', dto, user.email);
  }

  @Post('rules/:id/deploy')
  @RequirePermissions('data_quality_rules.edit')
  deployRule(@Param('id') id: string, @Body() dto: DataQualityRuleTransitionDto, @CurrentUser() user: AuthUser) {
    return this.service.transitionRule(id, user.roles, 'deploy', dto, user.email);
  }

  @Post('rules/:id/retire')
  @RequirePermissions('data_quality_rules.edit')
  retireRule(@Param('id') id: string, @Body() dto: DataQualityRuleTransitionDto, @CurrentUser() user: AuthUser) {
    return this.service.transitionRule(id, user.roles, 'retire', dto, user.email);
  }

  @Get('profiles')
  @RequirePermissions('data_quality_profiles.view')
  profiles(@CurrentUser() user: AuthUser, @Query('page') page?: string, @Query('pageSize') pageSize?: string) {
    return this.service.listProfiles(user.roles, page, pageSize);
  }

  @Post('profiles/import')
  @RequirePermissions('data_quality_profiles.create')
  importProfile(@Body() dto: ImportDataQualityProfileDto, @CurrentUser() user: AuthUser) {
    return this.service.importProfile(user.roles, dto, user.email);
  }

  @Get('issues')
  @RequirePermissions('data_quality_issues.view')
  list(
    @CurrentUser() user: AuthUser,
    @Query('search') search?: string,
    @Query('status') status?: string,
    @Query('severity') severity?: string,
    @Query('dimension') dimension?: string,
    @Query('assetId') assetId?: string,
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
  ) {
    return this.service.list(user.roles, { search, status, severity, dimension, assetId }, page, pageSize);
  }

  @Get('issues/:id')
  @RequirePermissions('data_quality_issues.view')
  get(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.service.get(user.roles, id);
  }

  @Post('issues')
  @RequirePermissions('data_quality_issues.create')
  create(@Body() dto: CreateDataQualityIssueDto, @CurrentUser() user: AuthUser) {
    return this.service.create(user.roles, dto, user.email);
  }

  @Post('issues/import')
  @RequirePermissions('data_quality_issues.import')
  import(@Body() dto: ImportDataQualityIssuesDto, @CurrentUser() user: AuthUser) {
    return this.service.importCsv(user.roles, dto.csv, user.email);
  }

  @Post('issues/import-file')
  @RequirePermissions('data_quality_issues.import')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: DATA_QUALITY_IMPORT_MAX_FILE_SIZE_BYTES } }))
  importFile(@UploadedFile() file: Express.Multer.File | undefined, @CurrentUser() user: AuthUser) {
    if (!file) throw new BadRequestException(DATA_QUALITY_IMPORT_API_MESSAGES.fileRequired);
    if (!isAcceptedDataQualityImportFile(file.originalname, file.mimetype)) {
      throw new BadRequestException(DATA_QUALITY_IMPORT_API_MESSAGES.unsupportedFile);
    }
    return this.service.importCsv(user.roles, file.buffer.toString('utf8'), user.email);
  }

  @Patch('issues/:id')
  @RequirePermissions('data_quality_issues.edit')
  update(@Param('id') id: string, @Body() dto: UpdateDataQualityIssueDto, @CurrentUser() user: AuthUser) {
    return this.service.update(id, user.roles, dto, user.email);
  }

  @Post('issues/:id/close')
  @RequirePermissions('data_quality_issues.edit')
  close(@Param('id') id: string, @Body() dto: CloseDataQualityIssueDto, @CurrentUser() user: AuthUser) {
    return this.service.close(id, user.roles, dto, user.email);
  }

  @Post('issues/:id/rca')
  @RequirePermissions('data_quality_issues.edit')
  rca(@Param('id') id: string, @Body() dto: UpsertDataQualityRcaDto, @CurrentUser() user: AuthUser) {
    return this.service.upsertRca(id, user.roles, dto, user.email);
  }

  @Delete('issues/:id')
  @RequirePermissions('data_quality_issues.delete')
  remove(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.service.remove(id, user.roles, user.email);
  }
}
