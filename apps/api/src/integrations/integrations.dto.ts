import { IsIn, IsNotEmpty, IsObject, IsOptional, IsString } from 'class-validator';

export const CATALOG_ADAPTERS = ['catalog_csv', 'mock_rest'] as const;
export type CatalogAdapter = (typeof CATALOG_ADAPTERS)[number];

export const INTEGRATION_ADAPTERS = [
  'catalog_csv',
  'mock_rest',
  'webhook_json',
  'mock_data_quality',
  'mock_dlp',
  'mock_open_data',
  'mock_foi',
  'mock_lms',
  'mock_siem',
  'mock_iam_sso',
] as const;

export const INTEGRATION_CONNECTOR_TYPES = [
  'catalog',
  'lineage',
  'data_quality',
  'dlp',
  'pdp',
  'ndi',
  'risk',
  'profiling',
  'training',
  'open_data',
  'foi',
  'lms',
  'siem',
  'iam_sso',
  'masking',
  'abac',
] as const;

export const INTEGRATION_DIRECTIONS = ['inbound', 'outbound', 'bidirectional'] as const;
export const INTEGRATION_SOURCE_TRUST = ['authoritative', 'trusted', 'observed', 'simulated'] as const;

export type IntegrationAdapter = (typeof INTEGRATION_ADAPTERS)[number];
export type IntegrationConnectorTypeDto = (typeof INTEGRATION_CONNECTOR_TYPES)[number];
export type IntegrationDirectionDto = (typeof INTEGRATION_DIRECTIONS)[number];
export type IntegrationSourceTrustDto = (typeof INTEGRATION_SOURCE_TRUST)[number];

export class PreviewCatalogMappingDto {
  @IsOptional() @IsString() connectorId?: string | null;
  @IsIn(CATALOG_ADAPTERS) adapterType!: CatalogAdapter;
  @IsOptional() @IsString() csv?: string | null;
}

export class RunCatalogSyncDto {
  @IsOptional() @IsString() connectorId?: string | null;
  @IsIn(CATALOG_ADAPTERS) adapterType!: CatalogAdapter;
  @IsOptional() @IsString() csv?: string | null;
  @IsOptional() @IsString() sourceName?: string | null;
}

export class SimulateWritebackDto {
  @IsOptional() @IsString() connectorId?: string | null;
  @IsOptional() @IsString() message?: string | null;
}

export class CreateIntegrationConnectorDto {
  @IsString() @IsNotEmpty() code!: string;
  @IsString() @IsNotEmpty() nameEn!: string;
  @IsString() @IsNotEmpty() nameAr!: string;
  @IsOptional() @IsString() description?: string | null;
  @IsOptional() @IsIn(INTEGRATION_CONNECTOR_TYPES) type?: IntegrationConnectorTypeDto;
  @IsOptional() @IsIn(INTEGRATION_DIRECTIONS) direction?: IntegrationDirectionDto;
  @IsOptional() @IsIn(INTEGRATION_SOURCE_TRUST) sourceTrust?: IntegrationSourceTrustDto;
  @IsOptional() @IsIn(INTEGRATION_ADAPTERS) adapterType?: IntegrationAdapter;
}

export class ReceiveIntegrationWebhookDto {
  @IsOptional() @IsString() externalEventId?: string | null;
  @IsOptional() @IsString() eventType?: string | null;
  @IsOptional() @IsString() sourceName?: string | null;
  @IsOptional() @IsString() entityType?: string | null;
  @IsOptional() @IsString() entityId?: string | null;
  @IsOptional() @IsObject() payload?: Record<string, unknown> | null;
}

export class RetryIntegrationEventDto {
  @IsOptional() @IsString() reason?: string | null;
}
