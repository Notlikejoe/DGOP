import { Body, Controller, Delete, Get, Param, Patch, Post, Put } from '@nestjs/common';
import { RolesService } from './roles.service';
import {
  CreateRoleDto,
  SetRolePermissionsDto,
  SetRoleScopesDto,
  UpdateRoleDto,
} from './roles.dto';
import { CurrentUser, RequirePermissions } from '../auth/decorators';
import { AuthUser } from '../auth/auth.types';

@Controller()
export class RolesController {
  constructor(private readonly service: RolesService) {}

  @Get('permissions')
  @RequirePermissions('roles.view')
  permissions() {
    return this.service.permissionsCatalog();
  }

  @Get('roles')
  @RequirePermissions('roles.view')
  list() {
    return this.service.list();
  }

  @Get('roles/:id')
  @RequirePermissions('roles.view')
  get(@Param('id') id: string) {
    return this.service.get(id);
  }

  @Get('roles/:id/scope-preview')
  @RequirePermissions('roles.view')
  scopePreview(@Param('id') id: string) {
    return this.service.scopePreview(id);
  }

  @Post('roles')
  @RequirePermissions('roles.create')
  create(@Body() dto: CreateRoleDto, @CurrentUser() user: AuthUser) {
    return this.service.create(dto, user.email);
  }

  @Patch('roles/:id')
  @RequirePermissions('roles.edit')
  update(@Param('id') id: string, @Body() dto: UpdateRoleDto, @CurrentUser() user: AuthUser) {
    return this.service.update(id, dto, user.email);
  }

  @Put('roles/:id/permissions')
  @RequirePermissions('roles.edit')
  setPermissions(
    @Param('id') id: string,
    @Body() dto: SetRolePermissionsDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.service.setPermissions(id, dto, user.email);
  }

  @Put('roles/:id/scopes')
  @RequirePermissions('roles.edit')
  setScopes(
    @Param('id') id: string,
    @Body() dto: SetRoleScopesDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.service.setScopes(id, dto, user.email);
  }

  @Delete('roles/:id')
  @RequirePermissions('roles.delete')
  remove(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.service.remove(id, user.email);
  }
}
