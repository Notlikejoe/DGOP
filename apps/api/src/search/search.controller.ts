import { Controller, Get, Query } from '@nestjs/common';
import { CurrentUser } from '../auth/decorators';
import { AuthUser } from '../auth/auth.types';
import { SearchService } from './search.service';

@Controller('search')
export class SearchController {
  constructor(private readonly service: SearchService) {}

  @Get()
  search(
    @CurrentUser() user: AuthUser,
    @Query('q') query?: string,
    @Query('limit') limit?: string,
  ) {
    return this.service.search(user, query, limit);
  }
}
