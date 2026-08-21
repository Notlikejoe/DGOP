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
import { AssetsService, AssetFilters } from './assets.service';
import {
  CreateAssetDto,
  CreateAssetRelationshipDto,
  ImportAssetsDto,
  UpdateAssetDto,
} from './assets.dto';
import { CurrentUser, RequirePermissions } from '../auth/decorators';
import { AuthUser } from '../auth/auth.types';

@Controller('assets')
export class AssetsController {
  constructor(private readonly service: AssetsService) {}

  @Get()
  @RequirePermissions('data_assets.view')
  list(
    @CurrentUser() user: AuthUser,
    @Query('search') search?: string,
    @Query('domainId') domainId?: string,
    @Query('subjectId') subjectId?: string,
    @Query('classificationId') classificationId?: string,
    @Query('systemId') systemId?: string,
    @Query('capabilityId') capabilityId?: string,
    @Query('orgUnitId') orgUnitId?: string,
    @Query('ownerStatus') ownerStatus?: string,
    @Query('lifecycleStatus') lifecycleStatus?: string,
    @Query('assetType') assetType?: string,
    @Query('assetSubtype') assetSubtype?: string,
    @Query('v6LifecycleState') v6LifecycleState?: string,
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
  ) {
    const filters: AssetFilters = {
      search,
      domainId,
      subjectId,
      classificationId,
      systemId,
      capabilityId,
      orgUnitId,
      ownerStatus,
      lifecycleStatus,
      assetType,
      assetSubtype,
      v6LifecycleState,
    };
    return this.service.list(user.roles, filters, page, pageSize);
  }

  @Get(':id')
  @RequirePermissions('data_assets.view')
  get(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.service.get(user.roles, id);
  }

  @Post()
  @RequirePermissions('data_assets.create')
  create(@Body() dto: CreateAssetDto, @CurrentUser() user: AuthUser) {
    return this.service.create(user.roles, dto, user.email);
  }

  @Post('import')
  @RequirePermissions('data_assets.import')
  import(@Body() dto: ImportAssetsDto, @CurrentUser() user: AuthUser) {
    return this.service.importCsv(user.roles, dto.csv, user.email);
  }

  @Post('import-preview')
  @RequirePermissions('data_assets.import')
  importPreview(@Body() dto: ImportAssetsDto, @CurrentUser() user: AuthUser) {
    return this.service.importPreview(user.roles, dto.csv);
  }

  @Patch(':id')
  @RequirePermissions('data_assets.edit')
  update(@Param('id') id: string, @Body() dto: UpdateAssetDto, @CurrentUser() user: AuthUser) {
    return this.service.update(id, user.roles, dto, user.email);
  }

  @Delete(':id')
  @RequirePermissions('data_assets.delete')
  remove(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.service.remove(id, user.roles, user.email);
  }

  @Post(':id/relationships')
  @RequirePermissions('data_assets.edit')
  addRelationship(
    @Param('id') id: string,
    @Body() dto: CreateAssetRelationshipDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.service.addRelationship(id, user.roles, dto, user.email);
  }

  @Delete(':id/relationships/:relId')
  @RequirePermissions('data_assets.edit')
  removeRelationship(
    @Param('id') id: string,
    @Param('relId') relId: string,
    @CurrentUser() user: AuthUser,
  ) {
    return this.service.removeRelationship(id, user.roles, relId, user.email);
  }
}
