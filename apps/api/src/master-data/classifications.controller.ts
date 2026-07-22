import { Body, Controller, Delete, Get, Param, ParseUUIDPipe, Patch, Post } from '@nestjs/common';
import { ClassificationsService } from './classifications.service';
import { CreateClassificationDto, UpdateClassificationDto } from './dto';
import { CurrentUser, RequirePermissions } from '../auth/decorators';
import { AuthUser } from '../auth/auth.types';

@Controller('classifications')
export class ClassificationsController {
  constructor(private readonly service: ClassificationsService) {}

  @Get()
  @RequirePermissions('classifications.view')
  list() {
    return this.service.list();
  }

  @Get(':id')
  @RequirePermissions('classifications.view')
  get(@Param('id', ParseUUIDPipe) id: string) {
    return this.service.get(id);
  }

  @Post()
  @RequirePermissions('classifications.create')
  create(@Body() dto: CreateClassificationDto, @CurrentUser() user: AuthUser) {
    return this.service.create(dto, user.email);
  }

  @Patch(':id')
  @RequirePermissions('classifications.edit')
  update(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateClassificationDto, @CurrentUser() user: AuthUser) {
    return this.service.update(id, dto, user.email);
  }

  @Delete(':id')
  @RequirePermissions('classifications.delete')
  remove(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: AuthUser) {
    return this.service.remove(id, user.email);
  }
}
