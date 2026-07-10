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
import { OpenDataCandidateStatus } from '@prisma/client';
import { CurrentUser, RequirePermissions } from '../auth/decorators';
import { AuthUser } from '../auth/auth.types';
import {
  CreateOpenDataCandidateFromAssetDto,
  CreateOpenDataCandidateDto,
  UpdateOpenDataCandidateDto,
  UpdateOpenDataStatusDto,
} from './open-data.dto';
import { OpenDataCandidateFilters, OpenDataService } from './open-data.service';

@Controller('open-data-candidates')
export class OpenDataController {
  constructor(private readonly service: OpenDataService) {}

  @Get('summary')
  @RequirePermissions('open_data_candidates.view')
  summary(@CurrentUser() user: AuthUser) {
    return this.service.summary(user.roles);
  }

  @Get()
  @RequirePermissions('open_data_candidates.view')
  list(
    @CurrentUser() user: AuthUser,
    @Query('search') search?: string,
    @Query('status') status?: OpenDataCandidateStatus,
    @Query('assetId') assetId?: string,
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
  ) {
    const filters: OpenDataCandidateFilters = {
      search,
      status,
      assetId,
      page: page ?? '1',
      pageSize: pageSize ?? '25',
    };
    return this.service.list(user.roles, filters);
  }

  @Get(':id')
  @RequirePermissions('open_data_candidates.view')
  get(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.service.get(user.roles, id);
  }

  @Post()
  @RequirePermissions('open_data_candidates.create')
  create(@Body() dto: CreateOpenDataCandidateDto, @CurrentUser() user: AuthUser) {
    return this.service.create(user.roles, dto, user.email);
  }

  @Post('from-asset/:assetId')
  @RequirePermissions('open_data_candidates.create')
  createFromAsset(
    @Param('assetId') assetId: string,
    @Body() dto: CreateOpenDataCandidateFromAssetDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.service.create(user.roles, { ...dto, assetId }, user.email);
  }

  @Patch(':id')
  @RequirePermissions('open_data_candidates.edit')
  update(
    @Param('id') id: string,
    @Body() dto: UpdateOpenDataCandidateDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.service.update(user.roles, id, dto, user.email);
  }

  @Patch(':id/status')
  @RequirePermissions('open_data_candidates.edit')
  updateStatus(
    @Param('id') id: string,
    @Body() dto: UpdateOpenDataStatusDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.service.updateStatus(user.roles, id, dto, user.email);
  }

  @Delete(':id')
  @RequirePermissions('open_data_candidates.delete')
  remove(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.service.remove(user.roles, id, user.email);
  }
}
