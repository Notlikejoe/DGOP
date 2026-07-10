import { IsIn, IsNotEmpty, IsOptional, IsString } from 'class-validator';

export const CATALOG_ADAPTERS = ['catalog_csv', 'mock_rest'] as const;
export type CatalogAdapter = (typeof CATALOG_ADAPTERS)[number];

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
}
