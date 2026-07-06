import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { CurrentUser, RequirePermissions } from '../auth/decorators';
import { AuthUser } from '../auth/auth.types';
import { DataQualityService } from './data-quality.service';
import {
  CloseDataQualityIssueDto,
  CreateDataQualityIssueDto,
  ImportDataQualityIssuesDto,
  UpdateDataQualityIssueDto,
} from './data-quality.dto';

@Controller('data-quality')
export class DataQualityController {
  constructor(private readonly service: DataQualityService) {}

  @Get('summary')
  @RequirePermissions('data_quality_issues.view')
  summary(@CurrentUser() user: AuthUser) {
    return this.service.summary(user.roles);
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

  @Delete('issues/:id')
  @RequirePermissions('data_quality_issues.delete')
  remove(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.service.remove(id, user.roles, user.email);
  }
}
