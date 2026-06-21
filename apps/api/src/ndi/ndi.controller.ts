import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { NdiSpecificationsService, SpecFilters } from './ndi.service';
import { CreateNdiSpecDto, ImportNdiSpecsDto, UpdateNdiSpecDto } from './ndi.dto';
import { CurrentUser, RequirePermissions } from '../auth/decorators';
import { AuthUser } from '../auth/auth.types';

@Controller('ndi')
export class NdiController {
  constructor(private readonly service: NdiSpecificationsService) {}

  @Get('domains')
  @RequirePermissions('ndi_specifications.view')
  domains() {
    return this.service.listDomains();
  }

  @Get('specifications')
  @RequirePermissions('ndi_specifications.view')
  list(
    @Query('search') search?: string,
    @Query('domainId') domainId?: string,
    @Query('type') type?: string,
    @Query('maturityLevel') maturityLevel?: string,
    @Query('status') status?: string,
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
  ) {
    const filters: SpecFilters = { search, domainId, type, maturityLevel, status };
    return this.service.list(filters, page, pageSize);
  }

  @Get('specifications/:id')
  @RequirePermissions('ndi_specifications.view')
  get(@Param('id') id: string) {
    return this.service.get(id);
  }

  @Post('specifications')
  @RequirePermissions('ndi_specifications.create')
  create(@Body() dto: CreateNdiSpecDto, @CurrentUser() user: AuthUser) {
    return this.service.create(dto, user.email);
  }

  @Post('specifications/import')
  @RequirePermissions('ndi_specifications.import')
  import(@Body() dto: ImportNdiSpecsDto, @CurrentUser() user: AuthUser) {
    return this.service.importCsv(dto.csv, user.email);
  }

  @Patch('specifications/:id')
  @RequirePermissions('ndi_specifications.edit')
  update(@Param('id') id: string, @Body() dto: UpdateNdiSpecDto, @CurrentUser() user: AuthUser) {
    return this.service.update(id, dto, user.email);
  }

  @Delete('specifications/:id')
  @RequirePermissions('ndi_specifications.delete')
  remove(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.service.remove(id, user.email);
  }
}
