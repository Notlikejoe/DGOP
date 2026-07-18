import { Controller, Get, Query } from '@nestjs/common';
import { CurrentUser, RequirePermissions } from '../auth/decorators';
import { AuthUser } from '../auth/auth.types';
import { SearchService } from './search.service';

@Controller('search')
export class SearchController {
  constructor(private readonly service: SearchService) {}

  @Get()
  @RequirePermissions('search.view')
  search(
    @CurrentUser() user: AuthUser,
    @Query('q') query?: string,
    @Query('limit') limit?: string,
  ) {
    return this.service.search(user, query, limit);
  }
}
