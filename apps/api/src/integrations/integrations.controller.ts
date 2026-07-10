import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { CurrentUser, RequirePermissions } from '../auth/decorators';
import { AuthUser } from '../auth/auth.types';
import {
  CreateIntegrationConnectorDto,
  PreviewCatalogMappingDto,
  RunCatalogSyncDto,
  SimulateWritebackDto,
} from './integrations.dto';
import { IntegrationsService } from './integrations.service';

@Controller('integrations')
export class IntegrationsController {
  constructor(private readonly service: IntegrationsService) {}

  @Get('summary')
  @RequirePermissions('integrations.view')
  summary(@CurrentUser() user: AuthUser) {
    return this.service.summary(user.roles);
  }

  @Get('connectors')
  @RequirePermissions('integrations.view')
  connectors(@CurrentUser() user: AuthUser) {
    return this.service.connectors(user.roles);
  }

  @Post('connectors')
  @RequirePermissions('integrations.create')
  createConnector(@Body() dto: CreateIntegrationConnectorDto, @CurrentUser() user: AuthUser) {
    return this.service.createConnector(dto, user.email);
  }

  @Get('batches')
  @RequirePermissions('integrations.view')
  batches(@CurrentUser() user: AuthUser, @Query('limit') limit?: string) {
    return this.service.batches(user.roles, limit ? Number(limit) : 25);
  }

  @Get('batches/:id/errors')
  @RequirePermissions('integrations.view')
  batchErrors(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.service.batchErrors(user.roles, id);
  }

  @Post('catalog/preview')
  @RequirePermissions('integrations.view')
  previewCatalog(@Body() dto: PreviewCatalogMappingDto) {
    return this.service.previewCatalog(dto);
  }

  @Post('catalog/sync')
  @RequirePermissions('integrations.run')
  runCatalogSync(@Body() dto: RunCatalogSyncDto, @CurrentUser() user: AuthUser) {
    return this.service.runCatalogSync(user.roles, dto, user.email);
  }

  @Post('assets/:assetId/writeback')
  @RequirePermissions('integrations.writeback')
  simulateWriteback(
    @Param('assetId') assetId: string,
    @Body() dto: SimulateWritebackDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.service.simulateWriteback(user.roles, assetId, dto, user.email);
  }
}
