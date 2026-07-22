import { Body, Controller, Delete, Get, Param, ParseUUIDPipe, Patch, Post } from '@nestjs/common';
import { StatusValuesService } from './status-values.service';
import { CreateStatusValueDto, UpdateStatusValueDto } from './dto';
import { CurrentUser, RequirePermissions } from '../auth/decorators';
import { AuthUser } from '../auth/auth.types';

@Controller('status-values')
export class StatusValuesController {
  constructor(private readonly service: StatusValuesService) {}

  @Get()
  @RequirePermissions('status_values.view')
  list() {
    return this.service.list();
  }

  @Get(':id')
  @RequirePermissions('status_values.view')
  get(@Param('id', ParseUUIDPipe) id: string) {
    return this.service.get(id);
  }

  @Post()
  @RequirePermissions('status_values.create')
  create(@Body() dto: CreateStatusValueDto, @CurrentUser() user: AuthUser) {
    return this.service.create(dto, user.email);
  }

  @Patch(':id')
  @RequirePermissions('status_values.edit')
  update(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateStatusValueDto, @CurrentUser() user: AuthUser) {
    return this.service.update(id, dto, user.email);
  }

  @Delete(':id')
  @RequirePermissions('status_values.delete')
  remove(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: AuthUser) {
    return this.service.remove(id, user.email);
  }
}
