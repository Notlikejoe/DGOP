import { Body, Controller, Delete, Get, Param, ParseUUIDPipe, Patch, Post } from '@nestjs/common';
import { OrganizationUnitsService } from './organization-units.service';
import { CreateOrgUnitDto, UpdateOrgUnitDto } from './dto';
import { CurrentUser, RequirePermissions } from '../auth/decorators';
import { AuthUser } from '../auth/auth.types';

@Controller('org-units')
export class OrganizationUnitsController {
  constructor(private readonly service: OrganizationUnitsService) {}

  @Get()
  @RequirePermissions('org_units.view')
  list() {
    return this.service.list();
  }

  @Get('tree')
  @RequirePermissions('org_units.view')
  tree() {
    return this.service.tree();
  }

  @Get(':id')
  @RequirePermissions('org_units.view')
  get(@Param('id', ParseUUIDPipe) id: string) {
    return this.service.get(id);
  }

  @Post()
  @RequirePermissions('org_units.create')
  create(@Body() dto: CreateOrgUnitDto, @CurrentUser() user: AuthUser) {
    return this.service.create(dto, user.email);
  }

  @Patch(':id')
  @RequirePermissions('org_units.edit')
  update(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateOrgUnitDto, @CurrentUser() user: AuthUser) {
    return this.service.update(id, dto, user.email);
  }

  @Delete(':id')
  @RequirePermissions('org_units.delete')
  remove(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: AuthUser) {
    return this.service.remove(id, user.email);
  }
}
