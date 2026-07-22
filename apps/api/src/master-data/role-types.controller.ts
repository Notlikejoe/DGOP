import { Body, Controller, Delete, Get, Param, ParseUUIDPipe, Patch, Post } from '@nestjs/common';
import { RoleTypesService } from './role-types.service';
import { CreateRoleTypeDto, UpdateRoleTypeDto } from './dto';
import { CurrentUser, RequirePermissions } from '../auth/decorators';
import { AuthUser } from '../auth/auth.types';

@Controller('role-types')
export class RoleTypesController {
  constructor(private readonly service: RoleTypesService) {}

  @Get()
  @RequirePermissions('role_types.view')
  list() {
    return this.service.list();
  }

  @Get(':id')
  @RequirePermissions('role_types.view')
  get(@Param('id', ParseUUIDPipe) id: string) {
    return this.service.get(id);
  }

  @Post()
  @RequirePermissions('role_types.create')
  create(@Body() dto: CreateRoleTypeDto, @CurrentUser() user: AuthUser) {
    return this.service.create(dto, user.email);
  }

  @Patch(':id')
  @RequirePermissions('role_types.edit')
  update(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateRoleTypeDto, @CurrentUser() user: AuthUser) {
    return this.service.update(id, dto, user.email);
  }

  @Delete(':id')
  @RequirePermissions('role_types.delete')
  remove(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: AuthUser) {
    return this.service.remove(id, user.email);
  }
}
