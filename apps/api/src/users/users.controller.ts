import { Body, Controller, Get, Param, Patch, Post, Put, Query } from '@nestjs/common';
import { UsersService } from './users.service';
import { CurrentUser, RequirePermissions } from '../auth/decorators';
import { AuthUser } from '../auth/auth.types';
import {
  CreateUserDto,
  ResetPasswordDto,
  SetUserRolesDto,
  UpdateUserDto,
} from './users.dto';

@Controller('users')
export class UsersController {
  constructor(private readonly users: UsersService) {}

  @Get()
  @RequirePermissions('users.view')
  list(@Query('page') page?: string, @Query('pageSize') pageSize?: string) {
    return this.users.listUsers(page, pageSize);
  }

  @Get('roles')
  @RequirePermissions('users.view')
  roles() {
    return this.users.listRoles();
  }

  @Post()
  @RequirePermissions('users.create')
  create(@Body() dto: CreateUserDto, @CurrentUser() user: AuthUser) {
    return this.users.create(dto, user.email);
  }

  @Patch(':id')
  @RequirePermissions('users.edit')
  update(@Param('id') id: string, @Body() dto: UpdateUserDto, @CurrentUser() user: AuthUser) {
    return this.users.update(id, dto, user.email);
  }

  @Put(':id/roles')
  @RequirePermissions('users.edit')
  setRoles(@Param('id') id: string, @Body() dto: SetUserRolesDto, @CurrentUser() user: AuthUser) {
    return this.users.setRoles(id, dto, user.email);
  }

  @Post(':id/reset-password')
  @RequirePermissions('users.edit')
  resetPassword(
    @Param('id') id: string,
    @Body() dto: ResetPasswordDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.users.resetPassword(id, dto, user.email);
  }
}
