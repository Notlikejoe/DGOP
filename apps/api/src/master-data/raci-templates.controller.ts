import { Body, Controller, Delete, Get, Param, ParseUUIDPipe, Patch, Post } from '@nestjs/common';
import { RaciTemplatesService } from './raci-templates.service';
import { CreateRaciTemplateDto, UpdateRaciTemplateDto } from './dto';
import { CurrentUser, RequirePermissions } from '../auth/decorators';
import { AuthUser } from '../auth/auth.types';

@Controller('raci-templates')
export class RaciTemplatesController {
  constructor(private readonly service: RaciTemplatesService) {}

  @Get()
  @RequirePermissions('raci_templates.view')
  list() {
    return this.service.list();
  }

  @Get(':id')
  @RequirePermissions('raci_templates.view')
  get(@Param('id', ParseUUIDPipe) id: string) {
    return this.service.get(id);
  }

  @Post()
  @RequirePermissions('raci_templates.create')
  create(@Body() dto: CreateRaciTemplateDto, @CurrentUser() user: AuthUser) {
    return this.service.create(dto, user.email);
  }

  @Patch(':id')
  @RequirePermissions('raci_templates.edit')
  update(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateRaciTemplateDto, @CurrentUser() user: AuthUser) {
    return this.service.update(id, dto, user.email);
  }

  @Delete(':id')
  @RequirePermissions('raci_templates.delete')
  remove(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: AuthUser) {
    return this.service.remove(id, user.email);
  }
}
