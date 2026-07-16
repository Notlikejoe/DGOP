import { Body, Controller, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { FoiRequestChannel, FoiRequestStatus } from '@prisma/client';
import { CurrentUser, RequirePermissions } from '../auth/decorators';
import { AuthUser } from '../auth/auth.types';
import {
  CreateFoiAppealDto,
  CreateFoiDisclosureDto,
  CreateFoiExemptionDto,
  CreateFoiRequestDto,
  SaveFoiDecisionDto,
  SaveFoiReviewDto,
  UpdateFoiRequestDto,
} from './foi.dto';
import { FoiRequestFilters, FoiService } from './foi.service';

@Controller('foi')
export class FoiController {
  constructor(private readonly service: FoiService) {}

  @Get('summary')
  @RequirePermissions('foi_requests.view')
  summary(@CurrentUser() user: AuthUser) {
    return this.service.summary(user.roles);
  }

  @Get('templates')
  @RequirePermissions('foi_requests.view')
  templates() {
    return this.service.templates();
  }

  @Get('requests')
  @RequirePermissions('foi_requests.view')
  list(
    @CurrentUser() user: AuthUser,
    @Query('search') search?: string,
    @Query('status') status?: FoiRequestStatus,
    @Query('channel') channel?: FoiRequestChannel,
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
  ) {
    const filters: FoiRequestFilters = { search, status, channel, page: page ?? '1', pageSize: pageSize ?? '25' };
    return this.service.list(user.roles, filters);
  }

  @Get('requests/:id')
  @RequirePermissions('foi_requests.view')
  get(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.service.get(user.roles, id);
  }

  @Post('requests')
  @RequirePermissions('foi_requests.create')
  create(@Body() dto: CreateFoiRequestDto, @CurrentUser() user: AuthUser) {
    return this.service.create(user.roles, dto, user.email);
  }

  @Patch('requests/:id')
  @RequirePermissions('foi_requests.edit')
  update(@Param('id') id: string, @Body() dto: UpdateFoiRequestDto, @CurrentUser() user: AuthUser) {
    return this.service.update(user.roles, id, dto, user.email);
  }

  @Post('requests/:id/reviews')
  @RequirePermissions('foi_requests.edit')
  saveReview(@Param('id') id: string, @Body() dto: SaveFoiReviewDto, @CurrentUser() user: AuthUser) {
    return this.service.saveReview(user.roles, id, dto, user.email);
  }

  @Post('requests/:id/exemptions')
  @RequirePermissions('foi_requests.edit')
  createExemption(@Param('id') id: string, @Body() dto: CreateFoiExemptionDto, @CurrentUser() user: AuthUser) {
    return this.service.createExemption(user.roles, id, dto, user.email);
  }

  @Post('requests/:id/decision')
  @RequirePermissions('foi_requests.edit')
  saveDecision(@Param('id') id: string, @Body() dto: SaveFoiDecisionDto, @CurrentUser() user: AuthUser) {
    return this.service.saveDecision(user.roles, id, dto, user.email);
  }

  @Post('requests/:id/disclosures')
  @RequirePermissions('foi_requests.edit')
  createDisclosure(@Param('id') id: string, @Body() dto: CreateFoiDisclosureDto, @CurrentUser() user: AuthUser) {
    return this.service.createDisclosure(user.roles, id, dto, user.email);
  }

  @Post('requests/:id/appeals')
  @RequirePermissions('foi_requests.edit')
  createAppeal(@Param('id') id: string, @Body() dto: CreateFoiAppealDto, @CurrentUser() user: AuthUser) {
    return this.service.createAppeal(user.roles, id, dto, user.email);
  }
}
