import { Body, Controller, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { CurrentUser, RequirePermissions } from '../auth/decorators';
import { AuthUser } from '../auth/auth.types';
import {
  CreateDataSharingAgreementDto,
  CreateDataSharingRequestDto,
  CreateDataSharingUsageMetricDto,
  SaveDataSharingReviewDto,
  UpdateDataSharingAgreementDto,
  UpdateDataSharingRequestDto,
} from './data-sharing.dto';
import { DataSharingFilters, DataSharingService } from './data-sharing.service';

@Controller('data-sharing')
export class DataSharingController {
  constructor(private readonly service: DataSharingService) {}

  @Get('summary')
  @RequirePermissions('data_sharing_requests.view')
  summary(@CurrentUser() user: AuthUser) {
    return this.service.summary(user.roles);
  }

  @Get('requests')
  @RequirePermissions('data_sharing_requests.view')
  listRequests(@CurrentUser() user: AuthUser, @Query('search') search?: string, @Query('status') status?: string, @Query('page') page?: string, @Query('pageSize') pageSize?: string) {
    const filters: DataSharingFilters = { search, status, page: page ?? '1', pageSize: pageSize ?? '25' };
    return this.service.listRequests(user.roles, filters);
  }

  @Get('requests/:id')
  @RequirePermissions('data_sharing_requests.view')
  getRequest(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.service.getRequest(user.roles, id);
  }

  @Post('requests')
  @RequirePermissions('data_sharing_requests.create')
  createRequest(@Body() dto: CreateDataSharingRequestDto, @CurrentUser() user: AuthUser) {
    return this.service.createRequest(user.roles, dto, user.email);
  }

  @Patch('requests/:id')
  @RequirePermissions('data_sharing_requests.edit')
  updateRequest(@Param('id') id: string, @Body() dto: UpdateDataSharingRequestDto, @CurrentUser() user: AuthUser) {
    return this.service.updateRequest(user.roles, id, dto, user.email);
  }

  @Post('requests/:id/reviews')
  @RequirePermissions('data_sharing_requests.edit')
  saveReview(@Param('id') id: string, @Body() dto: SaveDataSharingReviewDto, @CurrentUser() user: AuthUser) {
    return this.service.saveReview(user.roles, id, dto, user.email);
  }

  @Get('agreements')
  @RequirePermissions('data_sharing_agreements.view')
  listAgreements(@CurrentUser() user: AuthUser, @Query('search') search?: string, @Query('status') status?: string, @Query('page') page?: string, @Query('pageSize') pageSize?: string) {
    const filters: DataSharingFilters = { search, status, page: page ?? '1', pageSize: pageSize ?? '25' };
    return this.service.listAgreements(user.roles, filters);
  }

  @Post('agreements')
  @RequirePermissions('data_sharing_agreements.create')
  createAgreement(@Body() dto: CreateDataSharingAgreementDto, @CurrentUser() user: AuthUser) {
    return this.service.createAgreement(user.roles, dto, user.email);
  }

  @Patch('agreements/:id')
  @RequirePermissions('data_sharing_agreements.edit')
  updateAgreement(@Param('id') id: string, @Body() dto: UpdateDataSharingAgreementDto, @CurrentUser() user: AuthUser) {
    return this.service.updateAgreement(user.roles, id, dto, user.email);
  }

  @Post('agreements/:id/usage')
  @RequirePermissions('data_sharing_agreements.edit')
  recordUsage(@Param('id') id: string, @Body() dto: CreateDataSharingUsageMetricDto, @CurrentUser() user: AuthUser) {
    return this.service.recordUsage(user.roles, id, dto, user.email);
  }
}
