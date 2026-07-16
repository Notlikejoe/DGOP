import { Body, Controller, Get, Headers, Param, Post, Query } from '@nestjs/common';
import { CurrentUser, Public, RequirePermissions } from '../auth/decorators';
import { AuthUser } from '../auth/auth.types';
import {
  CreateIntegrationConnectorDto,
  PreviewCatalogMappingDto,
  ReceiveIntegrationWebhookDto,
  RetryIntegrationEventDto,
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

  @Get('events')
  @RequirePermissions('integrations.view')
  events(@CurrentUser() user: AuthUser, @Query('status') status?: string, @Query('limit') limit?: string) {
    return this.service.events(user.roles, status, limit ? Number(limit) : 25);
  }

  @Post('events/:id/retry')
  @RequirePermissions('integrations.run')
  retryEvent(
    @Param('id') id: string,
    @Body() dto: RetryIntegrationEventDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.service.retryEvent(user.roles, id, dto, user.email);
  }

  @Get('reconciliation')
  @RequirePermissions('integrations.view')
  reconciliation(@CurrentUser() user: AuthUser, @Query('limit') limit?: string) {
    return this.service.reconciliationReports(user.roles, limit ? Number(limit) : 20);
  }

  @Post('webhooks/:connectorCode')
  @Public()
  receiveWebhook(
    @Param('connectorCode') connectorCode: string,
    @Body() dto: ReceiveIntegrationWebhookDto,
    @Headers('x-dgop-webhook-token') token?: string,
  ) {
    return this.service.receiveWebhook(connectorCode, dto, token);
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
