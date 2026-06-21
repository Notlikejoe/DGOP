import { Body, Controller, Delete, Get, Param, Patch, Post } from '@nestjs/common';
import { DataDomainsService } from './data-domains.service';
import { CreateHierarchyNodeDto, UpdateHierarchyNodeDto } from './dto';
import { CurrentUser, RequirePermissions } from '../auth/decorators';
import { AuthUser } from '../auth/auth.types';

@Controller('data-domains')
export class DataDomainsController {
  constructor(private readonly service: DataDomainsService) {}

  @Get()
  @RequirePermissions('data_domains.view')
  list() {
    return this.service.list();
  }

  @Get('tree')
  @RequirePermissions('data_domains.view')
  tree() {
    return this.service.tree();
  }

  @Get(':id')
  @RequirePermissions('data_domains.view')
  get(@Param('id') id: string) {
    return this.service.get(id);
  }

  @Post()
  @RequirePermissions('data_domains.create')
  create(@Body() dto: CreateHierarchyNodeDto, @CurrentUser() user: AuthUser) {
    return this.service.create(dto, user.email);
  }

  @Patch(':id')
  @RequirePermissions('data_domains.edit')
  update(@Param('id') id: string, @Body() dto: UpdateHierarchyNodeDto, @CurrentUser() user: AuthUser) {
    return this.service.update(id, dto, user.email);
  }

  @Delete(':id')
  @RequirePermissions('data_domains.delete')
  remove(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.service.remove(id, user.email);
  }
}
