import { Body, Controller, Get, Post, Query } from '@nestjs/common';
import { CurrentUser, RequirePermissions } from '../auth/decorators';
import { AuthUser } from '../auth/auth.types';
import { SearchService } from './search.service';
import { SaveSearchDto, SearchAnalyticsClickDto, UpsertSearchRegistryDto } from './search.dto';

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

  @Get('autocomplete')
  @RequirePermissions('search.view')
  autocomplete(@CurrentUser() user: AuthUser, @Query('q') query?: string, @Query('limit') limit?: string) {
    return this.service.autocomplete(user, query, limit);
  }

  @Get('registry')
  @RequirePermissions('search.view')
  registry() {
    return this.service.registry();
  }

  @Get('engine/status')
  @RequirePermissions('search.view')
  engineStatus() {
    return this.service.engineStatus();
  }

  @Post('index/refresh')
  @RequirePermissions('governance_operations.edit')
  refreshIndex(@CurrentUser() user: AuthUser) {
    return this.service.refreshIndex(user);
  }

  @Post('index/process')
  @RequirePermissions('governance_operations.edit')
  processIndex(@CurrentUser() user: AuthUser, @Query('limit') limit?: string) {
    return this.service.processIndexChanges(user, limit);
  }

  @Post('registry')
  @RequirePermissions('governance_operations.edit')
  upsertRegistry(@Body() dto: UpsertSearchRegistryDto, @CurrentUser() user: AuthUser) {
    return this.service.upsertRegistry(dto, user);
  }

  @Get('saved')
  @RequirePermissions('search.view')
  saved(@CurrentUser() user: AuthUser) {
    return this.service.savedSearches(user);
  }

  @Post('saved')
  @RequirePermissions('search.create')
  save(@Body() dto: SaveSearchDto, @CurrentUser() user: AuthUser) {
    return this.service.saveSearch(dto, user);
  }

  @Post('analytics/click')
  @RequirePermissions('search.analytics')
  click(@Body() dto: SearchAnalyticsClickDto, @CurrentUser() user: AuthUser) {
    return this.service.recordClick(dto, user);
  }
}
