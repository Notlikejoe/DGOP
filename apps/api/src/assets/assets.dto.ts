import {
  IsArray,
  IsIn,
  IsNotEmpty,
  IsOptional,
  IsString,
} from 'class-validator';

export const LIFECYCLE_STATUSES = ['draft', 'active', 'deprecated', 'retired'] as const;
export const OWNER_STATUSES = ['assigned', 'unassigned'] as const;
export const RELATIONSHIP_TYPES = ['derived_from', 'feeds', 'replicates', 'related_to'] as const;

// ---------- Data Assets ----------
export class CreateAssetDto {
  @IsString() @IsNotEmpty() code!: string;
  @IsString() @IsNotEmpty() nameEn!: string;
  @IsString() @IsNotEmpty() nameAr!: string;
  @IsOptional() @IsString() description?: string;
  @IsOptional() @IsIn(LIFECYCLE_STATUSES) lifecycleStatus?: string;
  @IsOptional() @IsString() ownerName?: string | null;
  @IsOptional() @IsString() domainId?: string | null;
  @IsOptional() @IsString() orgUnitId?: string | null;
  @IsOptional() @IsString() systemId?: string | null;
  @IsOptional() @IsString() capabilityId?: string | null;
  @IsOptional() @IsString() classificationId?: string | null;
  @IsOptional() @IsArray() @IsString({ each: true }) subjectIds?: string[];
}

export class UpdateAssetDto {
  @IsOptional() @IsString() @IsNotEmpty() code?: string;
  @IsOptional() @IsString() @IsNotEmpty() nameEn?: string;
  @IsOptional() @IsString() @IsNotEmpty() nameAr?: string;
  @IsOptional() @IsString() description?: string | null;
  @IsOptional() @IsIn(LIFECYCLE_STATUSES) lifecycleStatus?: string;
  @IsOptional() @IsString() ownerName?: string | null;
  @IsOptional() @IsString() domainId?: string | null;
  @IsOptional() @IsString() orgUnitId?: string | null;
  @IsOptional() @IsString() systemId?: string | null;
  @IsOptional() @IsString() capabilityId?: string | null;
  @IsOptional() @IsString() classificationId?: string | null;
  @IsOptional() @IsArray() @IsString({ each: true }) subjectIds?: string[];
}

// ---------- Asset Relationships ----------
export class CreateAssetRelationshipDto {
  @IsString() @IsNotEmpty() targetAssetId!: string;
  @IsIn(RELATIONSHIP_TYPES) type!: string;
  @IsOptional() @IsString() description?: string | null;
}

// ---------- CSV Import ----------
export class ImportAssetsDto {
  @IsString() @IsNotEmpty() csv!: string;
}
