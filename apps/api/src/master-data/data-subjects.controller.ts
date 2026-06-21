import { Body, Controller, Delete, Get, Param, Patch, Post } from '@nestjs/common';
import { DataSubjectsService } from './data-subjects.service';
import { CreateDataSubjectDto, UpdateDataSubjectDto } from './dto';
import { CurrentUser, RequirePermissions } from '../auth/decorators';
import { AuthUser } from '../auth/auth.types';

@Controller('data-subjects')
export class DataSubjectsController {
  constructor(private readonly service: DataSubjectsService) {}

  @Get()
  @RequirePermissions('data_subjects.view')
  list() {
    return this.service.list();
  }

  @Get(':id')
  @RequirePermissions('data_subjects.view')
  get(@Param('id') id: string) {
    return this.service.get(id);
  }

  @Post()
  @RequirePermissions('data_subjects.create')
  create(@Body() dto: CreateDataSubjectDto, @CurrentUser() user: AuthUser) {
    return this.service.create(dto, user.email);
  }

  @Patch(':id')
  @RequirePermissions('data_subjects.edit')
  update(@Param('id') id: string, @Body() dto: UpdateDataSubjectDto, @CurrentUser() user: AuthUser) {
    return this.service.update(id, dto, user.email);
  }

  @Delete(':id')
  @RequirePermissions('data_subjects.delete')
  remove(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.service.remove(id, user.email);
  }
}
