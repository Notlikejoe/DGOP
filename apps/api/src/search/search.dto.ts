import { IsBoolean, IsInt, IsNotEmpty, IsObject, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';
import { Type } from 'class-transformer';

export class SaveSearchDto {
  @IsString() @IsNotEmpty() @MaxLength(120) name!: string;
  @IsString() @IsNotEmpty() @MaxLength(240) query!: string;
  @IsOptional() @IsObject() filtersJson?: Record<string, unknown> | null;
  @IsOptional() @IsBoolean() isDefault?: boolean;
}

export class UpsertSearchRegistryDto {
  @IsString() @IsNotEmpty() @MaxLength(80) code!: string;
  @IsString() @IsNotEmpty() @MaxLength(80) entityType!: string;
  @IsString() @IsNotEmpty() @MaxLength(160) nameEn!: string;
  @IsOptional() @IsString() @MaxLength(160) nameAr?: string | null;
  @IsString() @IsNotEmpty() @MaxLength(300) routeTemplate!: string;
  @IsString() @IsNotEmpty() @MaxLength(120) permission!: string;
  @IsObject() fieldsJson!: Record<string, unknown>;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100) rankWeight?: number;
  @IsOptional() @IsString() @MaxLength(80) indexStrategy?: string;
  @IsOptional() @IsBoolean() includeInAutocomplete?: boolean;
  @IsOptional() @IsBoolean() isActive?: boolean;
}

export class SearchAnalyticsClickDto {
  @IsString() @IsNotEmpty() @MaxLength(240) query!: string;
  @IsOptional() @Type(() => Number) @IsInt() @Min(0) @Max(1000) resultCount?: number;
  @IsString() @IsNotEmpty() @MaxLength(80) selectedEntityType!: string;
  @IsString() @IsNotEmpty() @MaxLength(160) selectedEntityId!: string;
  @IsOptional() @IsString() @MaxLength(80) source?: string;
}
