import { Type } from 'class-transformer';
import {
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  Max,
  Min,
  ValidateNested,
} from 'class-validator';

// ---------- Organization Units ----------
export class CreateOrgUnitDto {
  @IsString() @IsNotEmpty() code!: string;
  @IsString() @IsNotEmpty() nameEn!: string;
  @IsString() @IsNotEmpty() nameAr!: string;
  @IsOptional() @IsString() parentId?: string | null;
  @IsOptional() @IsBoolean() isActive?: boolean;
}
export class UpdateOrgUnitDto {
  @IsOptional() @IsString() @IsNotEmpty() code?: string;
  @IsOptional() @IsString() @IsNotEmpty() nameEn?: string;
  @IsOptional() @IsString() @IsNotEmpty() nameAr?: string;
  @IsOptional() @IsString() parentId?: string | null;
  @IsOptional() @IsBoolean() isActive?: boolean;
}

// ---------- Hierarchical entities: Data Domains & Business Capabilities ----------
export class CreateHierarchyNodeDto {
  @IsString() @IsNotEmpty() code!: string;
  @IsString() @IsNotEmpty() nameEn!: string;
  @IsString() @IsNotEmpty() nameAr!: string;
  @IsOptional() @IsString() description?: string;
  @IsOptional() @IsString() parentId?: string | null;
  @IsOptional() @IsBoolean() isActive?: boolean;
}
export class UpdateHierarchyNodeDto {
  @IsOptional() @IsString() @IsNotEmpty() code?: string;
  @IsOptional() @IsString() @IsNotEmpty() nameEn?: string;
  @IsOptional() @IsString() @IsNotEmpty() nameAr?: string;
  @IsOptional() @IsString() description?: string;
  @IsOptional() @IsString() parentId?: string | null;
  @IsOptional() @IsBoolean() isActive?: boolean;
}

// ---------- Data Subjects (flat) ----------
export class CreateDataSubjectDto {
  @IsString() @IsNotEmpty() code!: string;
  @IsString() @IsNotEmpty() nameEn!: string;
  @IsString() @IsNotEmpty() nameAr!: string;
  @IsOptional() @IsString() description?: string;
  @IsOptional() @IsBoolean() isActive?: boolean;
}
export class UpdateDataSubjectDto {
  @IsOptional() @IsString() @IsNotEmpty() code?: string;
  @IsOptional() @IsString() @IsNotEmpty() nameEn?: string;
  @IsOptional() @IsString() @IsNotEmpty() nameAr?: string;
  @IsOptional() @IsString() description?: string;
  @IsOptional() @IsBoolean() isActive?: boolean;
}

// ---------- Systems / Platforms ----------
export class CreateSystemDto {
  @IsString() @IsNotEmpty() code!: string;
  @IsString() @IsNotEmpty() nameEn!: string;
  @IsString() @IsNotEmpty() nameAr!: string;
  @IsOptional() @IsString() description?: string;
  @IsOptional() @IsString() vendor?: string;
  @IsOptional() @IsString() type?: string;
  @IsOptional() @IsString() ownerOrgUnitId?: string | null;
  @IsOptional() @IsBoolean() isActive?: boolean;
}
export class UpdateSystemDto {
  @IsOptional() @IsString() @IsNotEmpty() code?: string;
  @IsOptional() @IsString() @IsNotEmpty() nameEn?: string;
  @IsOptional() @IsString() @IsNotEmpty() nameAr?: string;
  @IsOptional() @IsString() description?: string;
  @IsOptional() @IsString() vendor?: string;
  @IsOptional() @IsString() type?: string;
  @IsOptional() @IsString() ownerOrgUnitId?: string | null;
  @IsOptional() @IsBoolean() isActive?: boolean;
}

// ---------- Classifications ----------
export class CreateClassificationDto {
  @IsString() @IsNotEmpty() code!: string;
  @IsString() @IsNotEmpty() nameEn!: string;
  @IsString() @IsNotEmpty() nameAr!: string;
  @IsInt() @Min(1) @Max(99) rank!: number;
  @IsString() @IsNotEmpty() color!: string;
  @IsOptional() @IsString() description?: string;
  @IsOptional() @IsBoolean() isActive?: boolean;
}
export class UpdateClassificationDto {
  @IsOptional() @IsString() @IsNotEmpty() code?: string;
  @IsOptional() @IsString() @IsNotEmpty() nameEn?: string;
  @IsOptional() @IsString() @IsNotEmpty() nameAr?: string;
  @IsOptional() @IsInt() @Min(1) @Max(99) rank?: number;
  @IsOptional() @IsString() @IsNotEmpty() color?: string;
  @IsOptional() @IsString() description?: string;
  @IsOptional() @IsBoolean() isActive?: boolean;
}

// ---------- Role Types ----------
export class CreateRoleTypeDto {
  @IsString() @IsNotEmpty() code!: string;
  @IsString() @IsNotEmpty() nameEn!: string;
  @IsString() @IsNotEmpty() nameAr!: string;
  @IsOptional() @IsString() description?: string;
  @IsOptional() @IsBoolean() isActive?: boolean;
}
export class UpdateRoleTypeDto {
  @IsOptional() @IsString() @IsNotEmpty() code?: string;
  @IsOptional() @IsString() @IsNotEmpty() nameEn?: string;
  @IsOptional() @IsString() @IsNotEmpty() nameAr?: string;
  @IsOptional() @IsString() description?: string;
  @IsOptional() @IsBoolean() isActive?: boolean;
}

// ---------- Status Values ----------
export class CreateStatusValueDto {
  @IsString() @IsNotEmpty() domain!: string;
  @IsString() @IsNotEmpty() code!: string;
  @IsString() @IsNotEmpty() nameEn!: string;
  @IsString() @IsNotEmpty() nameAr!: string;
  @IsString() @IsNotEmpty() color!: string;
  @IsOptional() @IsInt() @Min(0) @Max(999) sortOrder?: number;
  @IsOptional() @IsBoolean() isActive?: boolean;
}
export class UpdateStatusValueDto {
  @IsOptional() @IsString() @IsNotEmpty() domain?: string;
  @IsOptional() @IsString() @IsNotEmpty() code?: string;
  @IsOptional() @IsString() @IsNotEmpty() nameEn?: string;
  @IsOptional() @IsString() @IsNotEmpty() nameAr?: string;
  @IsOptional() @IsString() @IsNotEmpty() color?: string;
  @IsOptional() @IsInt() @Min(0) @Max(999) sortOrder?: number;
  @IsOptional() @IsBoolean() isActive?: boolean;
}

// ---------- RACI Templates ----------
export class RaciItemDto {
  @IsString() @IsNotEmpty() roleTypeId!: string;
  @IsIn(['R', 'A', 'C', 'I']) responsibility!: 'R' | 'A' | 'C' | 'I';
}
export class CreateRaciTemplateDto {
  @IsString() @IsNotEmpty() code!: string;
  @IsString() @IsNotEmpty() nameEn!: string;
  @IsString() @IsNotEmpty() nameAr!: string;
  @IsOptional() @IsString() description?: string;
  @IsOptional() @IsString() processType?: string;
  @IsOptional() @IsBoolean() isActive?: boolean;
  @IsArray() @ValidateNested({ each: true }) @Type(() => RaciItemDto) items!: RaciItemDto[];
}
export class UpdateRaciTemplateDto {
  @IsOptional() @IsString() @IsNotEmpty() code?: string;
  @IsOptional() @IsString() @IsNotEmpty() nameEn?: string;
  @IsOptional() @IsString() @IsNotEmpty() nameAr?: string;
  @IsOptional() @IsString() description?: string;
  @IsOptional() @IsString() processType?: string;
  @IsOptional() @IsBoolean() isActive?: boolean;
  @IsOptional() @IsArray() @ValidateNested({ each: true }) @Type(() => RaciItemDto) items?: RaciItemDto[];
}
