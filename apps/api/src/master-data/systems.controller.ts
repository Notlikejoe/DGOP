import { Body, Controller, Delete, Get, Param, ParseUUIDPipe, Patch, Post } from '@nestjs/common';
import { SystemsService } from './systems.service';
import { CreateSystemDto, UpdateSystemDto } from './dto';
import { CurrentUser, RequirePermissions } from '../auth/decorators';
import { AuthUser } from '../auth/auth.types';

@Controller('systems')
export class SystemsController {
  constructor(private readonly service: SystemsService) {}

  @Get()
  @RequirePermissions('systems.view')
  list() {
    return this.service.list();
  }

  @Get(':id')
  @RequirePermissions('systems.view')
  get(@Param('id', ParseUUIDPipe) id: string) {
    return this.service.get(id);
  }

  @Post()
  @RequirePermissions('systems.create')
  create(@Body() dto: CreateSystemDto, @CurrentUser() user: AuthUser) {
    return this.service.create(dto, user.email);
  }

  @Patch(':id')
  @RequirePermissions('systems.edit')
  update(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateSystemDto, @CurrentUser() user: AuthUser) {
    return this.service.update(id, dto, user.email);
  }

  @Delete(':id')
  @RequirePermissions('systems.delete')
  remove(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: AuthUser) {
    return this.service.remove(id, user.email);
  }
}
