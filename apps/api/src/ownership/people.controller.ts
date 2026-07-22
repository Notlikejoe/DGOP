import { Body, Controller, Delete, Get, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { PeopleService } from './people.service';
import { CreatePersonDto, UpdatePersonDto } from './people.dto';
import { CurrentUser, RequirePermissions } from '../auth/decorators';
import { AuthUser } from '../auth/auth.types';

@Controller('people')
export class PeopleController {
  constructor(private readonly service: PeopleService) {}

  @Get()
  @RequirePermissions('people.view')
  list(
    @Query('search') search?: string,
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
  ) {
    return this.service.listPaged(search, page, pageSize);
  }

  // Any authenticated user may resolve their own governance person (declare before :id).
  @Get('me')
  me(@CurrentUser() user: AuthUser) {
    return this.service.findByUserId(user.id);
  }

  @Get(':id')
  @RequirePermissions('people.view')
  get(@Param('id', ParseUUIDPipe) id: string) {
    return this.service.get(id);
  }

  @Post()
  @RequirePermissions('people.create')
  create(@Body() dto: CreatePersonDto, @CurrentUser() user: AuthUser) {
    return this.service.create(dto, user.email);
  }

  @Patch(':id')
  @RequirePermissions('people.edit')
  update(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdatePersonDto, @CurrentUser() user: AuthUser) {
    return this.service.update(id, dto, user.email);
  }

  @Delete(':id')
  @RequirePermissions('people.delete')
  remove(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: AuthUser) {
    return this.service.remove(id, user.email);
  }
}
