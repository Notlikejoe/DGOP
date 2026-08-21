import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsDateString,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';

export const ACCESS_GRANT_PRINCIPAL_TYPES = ['role', 'group'] as const;
export const ACCESS_GRANT_LEGACY_PRINCIPAL_TYPES = ['user', 'role', 'group', 'service_account'] as const;
export const ACCESS_GRANT_OWNER_DECISIONS = ['approved', 'rejected'] as const;
export const ACCESS_GRANT_ENFORCEMENT_STATUSES = ['pending', 'enforced', 'failed', 'not_enforced', 'revoked'] as const;
export const ACCESS_ASSET_TYPES = ['dataset', 'file', 'document_record', 'api_data_feed', 'bi_report_dashboard', 'ai_data_product'] as const;

export class ListAccessGrantsDto {
  @IsOptional() @IsUUID('4') assetId?: string;
  @IsOptional() @IsString() principalId?: string;
  @IsOptional() @IsString() status?: string;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) page?: number;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(200) pageSize?: number;
}

export class CreateAccessGrantDto {
  @IsUUID('4') assetId!: string;
  @IsIn(ACCESS_GRANT_PRINCIPAL_TYPES) principalType!: string;
  @IsString() @IsNotEmpty() @MaxLength(160) principalId!: string;
  @IsOptional() @IsString() @IsNotEmpty() @MaxLength(120) permissionCode?: string;
  @IsOptional() @IsArray() @ArrayMinSize(1) @ArrayMaxSize(100) @IsString({ each: true }) @MaxLength(120, { each: true }) permissionCodes?: string[];
  @IsOptional() @IsUUID('4') profileId?: string | null;
  @IsOptional() @IsDateString() startsAt?: string;
  @IsOptional() @IsDateString() expiresAt?: string | null;
  @IsString() @IsNotEmpty() @MaxLength(1200) justification!: string;
  @IsOptional() @IsUUID('4') workflowCaseId?: string | null;
}

export class UpdateAccessGrantDto {
  @Type(() => Number) @IsInt() @Min(1) expectedVersion!: number;
  @IsOptional() @IsUUID('4') profileId?: string | null;
  @IsOptional() @IsArray() @ArrayMinSize(1) @ArrayMaxSize(100) @IsString({ each: true }) @MaxLength(120, { each: true }) permissionCodes?: string[];
  @IsOptional() @IsDateString() startsAt?: string;
  @IsOptional() @IsDateString() expiresAt?: string | null;
  @IsOptional() @IsString() @IsNotEmpty() @MaxLength(1200) justification?: string;
  @IsString() @IsNotEmpty() @MaxLength(1200) changeReason!: string;
}

export class BulkAccessGrantCellDto {
  @IsUUID('4') assetId!: string;
  @IsIn(ACCESS_GRANT_PRINCIPAL_TYPES) principalType!: string;
  @IsString() @IsNotEmpty() @MaxLength(160) principalId!: string;
}

export class BulkCreateAccessGrantDto {
  @IsArray() @ArrayMinSize(1) @ArrayMaxSize(500) @ValidateNested({ each: true }) @Type(() => BulkAccessGrantCellDto)
  cells!: BulkAccessGrantCellDto[];
  @IsOptional() @IsUUID('4') profileId?: string | null;
  @IsOptional() @IsArray() @ArrayMinSize(1) @ArrayMaxSize(100) @IsString({ each: true }) @MaxLength(120, { each: true }) permissionCodes?: string[];
  @IsOptional() @IsDateString() startsAt?: string;
  @IsOptional() @IsDateString() expiresAt?: string | null;
  @IsString() @IsNotEmpty() @MaxLength(1200) justification!: string;
  @IsString() @IsNotEmpty() @MaxLength(1200) changeReason!: string;
}

export class DecideAccessGrantDto {
  @Type(() => Number) @IsInt() @Min(1) expectedVersion!: number;
  @IsIn(ACCESS_GRANT_OWNER_DECISIONS) decision!: string;
  @IsOptional() @IsString() @MaxLength(1200) comment?: string | null;
}

export class UpdateAccessGrantEnforcementDto {
  @Type(() => Number) @IsInt() @Min(1) expectedVersion!: number;
  @IsIn(ACCESS_GRANT_ENFORCEMENT_STATUSES) enforcementStatus!: string;
  @IsOptional() @IsString() @MaxLength(1200) comment?: string | null;
}

export class RevokeAccessGrantDto {
  @Type(() => Number) @IsInt() @Min(1) expectedVersion!: number;
  @IsString() @IsNotEmpty() @MaxLength(1200) reason!: string;
}

export class ValidateAccessGrantImportDto {
  @IsString() @IsNotEmpty() @MaxLength(2_000_000) csv!: string;
}

export class CommitAccessGrantImportDto {
  @IsString() @IsNotEmpty() @MaxLength(2_000_000) csv!: string;
  @IsOptional() @IsString() @MaxLength(500) changeReason?: string | null;
}

export class AccessMatrixQueryDto {
  @IsOptional() @IsString() @MaxLength(160) assetSearch?: string;
  @IsOptional() @IsIn(ACCESS_ASSET_TYPES) assetType?: string;
  @IsOptional() @IsUUID('4') domainId?: string;
  @IsOptional() @IsUUID('4') classificationId?: string;
  @IsOptional() @IsUUID('4') systemId?: string;
  @IsOptional() @IsIn(['role', 'group']) principalType?: string;
  @IsOptional() @IsString() @MaxLength(160) principalSearch?: string;
  @IsOptional() @IsUUID('4') profileId?: string;
  @IsOptional() @IsString() @MaxLength(120) permissionCode?: string;
  @IsOptional() @IsString() @MaxLength(80) status?: string;
  @IsOptional() @IsIn(ACCESS_GRANT_ENFORCEMENT_STATUSES) enforcementStatus?: string;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) assetPage?: number;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(500) assetLimit?: number;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100) principalLimit?: number;
  @IsOptional() @IsIn(['code', 'name', 'asset_type', 'status']) sortBy?: string;
  @IsOptional() @IsIn(['asc', 'desc']) sortDirection?: 'asc' | 'desc';
}

export class ListEffectiveAccessDto {
  @IsOptional() @IsUUID('4') assetId?: string;
  @IsOptional() @IsString() principalId?: string;
  @IsOptional() @IsIn(ACCESS_GRANT_LEGACY_PRINCIPAL_TYPES) principalType?: string;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) page?: number;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(200) pageSize?: number;
}

export class DispatchAccessEnforcementDto {
  @Type(() => Number) @IsInt() @Min(1) expectedVersion!: number;
  @IsIn(['grant', 'update', 'revoke', 'verify']) operation!: string;
  @IsOptional() @IsString() @MaxLength(120) connectorCode?: string;
}

export class CompleteManualAccessEnforcementDto {
  @Type(() => Number) @IsInt() @Min(1) expectedVersion!: number;
  @IsIn(['enforced', 'failed', 'not_enforced']) enforcementStatus!: string;
  @IsString() @IsNotEmpty() @MaxLength(500) evidenceReference!: string;
  @IsOptional() @IsString() @MaxLength(1200) comment?: string | null;
}

export class CompleteAccessEnforcementAttemptDto {
  @Type(() => Number) @IsInt() @Min(1) expectedVersion!: number;
  @IsIn(['succeeded', 'failed']) status!: 'succeeded' | 'failed';
  @IsString() @IsNotEmpty() @MaxLength(500) providerReference!: string;
  @IsOptional() @IsString() @MaxLength(120) errorCode?: string | null;
  @IsOptional() @IsString() @MaxLength(1200) message?: string | null;
}
