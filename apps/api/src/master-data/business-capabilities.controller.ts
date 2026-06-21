import { Body, Controller, Delete, Get, Param, Patch, Post } from '@nestjs/common';
import { BusinessCapabilitiesService } from './business-capabilities.service';
import { CreateHierarchyNodeDto, UpdateHierarchyNodeDto } from './dto';
import { CurrentUser, RequirePermissions } from '../auth/decorators';
import { AuthUser } from '../auth/auth.types';

@Controller('business-capabilities')
export class BusinessCapabilitiesController {
  constructor(private readonly service: BusinessCapabilitiesService) {}

  @Get()
  @RequirePermissions('business_capabilities.view')
  list() {
    return this.service.list();
  }

  @Get('tree')
  @RequirePermissions('business_capabilities.view')
  tree() {
    return this.service.tree();
  }

  @Get(':id')
  @RequirePermissions('business_capabilities.view')
  get(@Param('id') id: string) {
    return this.service.get(id);
  }

  @Post()
  @RequirePermissions('business_capabilities.create')
  create(@Body() dto: CreateHierarchyNodeDto, @CurrentUser() user: AuthUser) {
    return this.service.create(dto, user.email);
  }

  @Patch(':id')
  @RequirePermissions('business_capabilities.edit')
  update(@Param('id') id: string, @Body() dto: UpdateHierarchyNodeDto, @CurrentUser() user: AuthUser) {
    return this.service.update(id, dto, user.email);
  }

  @Delete(':id')
  @RequirePermissions('business_capabilities.delete')
  remove(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.service.remove(id, user.email);
  }
}
