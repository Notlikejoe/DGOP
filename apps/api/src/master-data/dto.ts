import { Type } from 'class-transformer';
import { Transform } from 'class-transformer';
import {
  ArrayMinSize,
  ArrayUnique,
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import {
  MASTER_CODE_MAX,
  MASTER_CODE_PATTERN,
  MASTER_COLOR_PATTERN,
  MASTER_DESCRIPTION_MAX,
  MASTER_NAME_MAX,
  MASTER_PROCESS_TYPE_MAX,
  MASTER_RANK_MAX,
  MASTER_SHORT_TEXT_MAX,
  MASTER_SORT_MAX,
} from './master-data.logic';

const Trim = () => Transform(({ value }) => (typeof value === 'string' ? value.trim() : value));
const TrimOptional = () =>
  Transform(({ value }) => {
    if (typeof value !== 'string') return value;
    const trimmed = value.trim();
    return trimmed.length ? trimmed : null;
  });

const CodeField = () => {
  return function codeDecorators(target: object, propertyKey: string | symbol) {
    IsString()(target, propertyKey);
    IsNotEmpty()(target, propertyKey);
    MaxLength(MASTER_CODE_MAX)(target, propertyKey);
    Matches(MASTER_CODE_PATTERN)(target, propertyKey);
    Trim()(target, propertyKey);
  };
};

const OptionalCodeField = () => {
  return function optionalCodeDecorators(target: object, propertyKey: string | symbol) {
    IsOptional()(target, propertyKey);
    IsString()(target, propertyKey);
    IsNotEmpty()(target, propertyKey);
    MaxLength(MASTER_CODE_MAX)(target, propertyKey);
    Matches(MASTER_CODE_PATTERN)(target, propertyKey);
    Trim()(target, propertyKey);
  };
};

const NameField = () => {
  return function nameDecorators(target: object, propertyKey: string | symbol) {
    IsString()(target, propertyKey);
    IsNotEmpty()(target, propertyKey);
    MaxLength(MASTER_NAME_MAX)(target, propertyKey);
    Trim()(target, propertyKey);
  };
};

const OptionalTextField = (max = MASTER_DESCRIPTION_MAX) => {
  return function optionalTextDecorators(target: object, propertyKey: string | symbol) {
    IsOptional()(target, propertyKey);
    IsString()(target, propertyKey);
    MaxLength(max)(target, propertyKey);
    TrimOptional()(target, propertyKey);
  };
};

const OptionalUuidField = () => {
  return function optionalUuidDecorators(target: object, propertyKey: string | symbol) {
    IsOptional()(target, propertyKey);
    IsUUID()(target, propertyKey);
    TrimOptional()(target, propertyKey);
  };
};

// ---------- Organization Units ----------
export class CreateOrgUnitDto {
  @CodeField() code!: string;
  @NameField() nameEn!: string;
  @NameField() nameAr!: string;
  @OptionalUuidField() parentId?: string | null;
  @IsOptional() @IsBoolean() isActive?: boolean;
}
export class UpdateOrgUnitDto {
  @OptionalCodeField() code?: string;
  @IsOptional() @NameField() nameEn?: string;
  @IsOptional() @NameField() nameAr?: string;
  @OptionalUuidField() parentId?: string | null;
  @IsOptional() @IsBoolean() isActive?: boolean;
}

// ---------- Hierarchical entities: Data Domains & Business Capabilities ----------
export class CreateHierarchyNodeDto {
  @CodeField() code!: string;
  @NameField() nameEn!: string;
  @NameField() nameAr!: string;
  @OptionalTextField() description?: string;
  @OptionalUuidField() parentId?: string | null;
  @IsOptional() @IsBoolean() isActive?: boolean;
}
export class UpdateHierarchyNodeDto {
  @OptionalCodeField() code?: string;
  @IsOptional() @NameField() nameEn?: string;
  @IsOptional() @NameField() nameAr?: string;
  @OptionalTextField() description?: string;
  @OptionalUuidField() parentId?: string | null;
  @IsOptional() @IsBoolean() isActive?: boolean;
}

// ---------- Data Subjects (flat) ----------
export class CreateDataSubjectDto {
  @CodeField() code!: string;
  @NameField() nameEn!: string;
  @NameField() nameAr!: string;
  @OptionalTextField() description?: string;
  @IsOptional() @IsBoolean() isActive?: boolean;
}
export class UpdateDataSubjectDto {
  @OptionalCodeField() code?: string;
  @IsOptional() @NameField() nameEn?: string;
  @IsOptional() @NameField() nameAr?: string;
  @OptionalTextField() description?: string;
  @IsOptional() @IsBoolean() isActive?: boolean;
}

// ---------- Systems / Platforms ----------
export class CreateSystemDto {
  @CodeField() code!: string;
  @NameField() nameEn!: string;
  @NameField() nameAr!: string;
  @OptionalTextField() description?: string;
  @OptionalTextField(MASTER_SHORT_TEXT_MAX) vendor?: string;
  @OptionalTextField(MASTER_SHORT_TEXT_MAX) type?: string;
  @OptionalUuidField() ownerOrgUnitId?: string | null;
  @IsOptional() @IsBoolean() isActive?: boolean;
}
export class UpdateSystemDto {
  @OptionalCodeField() code?: string;
  @IsOptional() @NameField() nameEn?: string;
  @IsOptional() @NameField() nameAr?: string;
  @OptionalTextField() description?: string;
  @OptionalTextField(MASTER_SHORT_TEXT_MAX) vendor?: string;
  @OptionalTextField(MASTER_SHORT_TEXT_MAX) type?: string;
  @OptionalUuidField() ownerOrgUnitId?: string | null;
  @IsOptional() @IsBoolean() isActive?: boolean;
}

// ---------- Classifications ----------
export class CreateClassificationDto {
  @CodeField() code!: string;
  @NameField() nameEn!: string;
  @NameField() nameAr!: string;
  @Type(() => Number) @IsInt() @Min(1) @Max(MASTER_RANK_MAX) rank!: number;
  @IsString() @IsNotEmpty() @Matches(MASTER_COLOR_PATTERN) @Trim() color!: string;
  @OptionalTextField() description?: string;
  @IsOptional() @IsBoolean() isActive?: boolean;
}
export class UpdateClassificationDto {
  @OptionalCodeField() code?: string;
  @IsOptional() @NameField() nameEn?: string;
  @IsOptional() @NameField() nameAr?: string;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(MASTER_RANK_MAX) rank?: number;
  @IsOptional() @IsString() @IsNotEmpty() @Matches(MASTER_COLOR_PATTERN) @Trim() color?: string;
  @OptionalTextField() description?: string;
  @IsOptional() @IsBoolean() isActive?: boolean;
}

// ---------- Role Types ----------
export class CreateRoleTypeDto {
  @CodeField() code!: string;
  @NameField() nameEn!: string;
  @NameField() nameAr!: string;
  @OptionalTextField() description?: string;
  @IsOptional() @IsBoolean() isActive?: boolean;
}
export class UpdateRoleTypeDto {
  @OptionalCodeField() code?: string;
  @IsOptional() @NameField() nameEn?: string;
  @IsOptional() @NameField() nameAr?: string;
  @OptionalTextField() description?: string;
  @IsOptional() @IsBoolean() isActive?: boolean;
}

// ---------- Status Values ----------
export class CreateStatusValueDto {
  @CodeField() domain!: string;
  @CodeField() code!: string;
  @NameField() nameEn!: string;
  @NameField() nameAr!: string;
  @IsString() @IsNotEmpty() @Matches(MASTER_COLOR_PATTERN) @Trim() color!: string;
  @IsOptional() @Type(() => Number) @IsInt() @Min(0) @Max(MASTER_SORT_MAX) sortOrder?: number;
  @IsOptional() @IsBoolean() isActive?: boolean;
}
export class UpdateStatusValueDto {
  @OptionalCodeField() domain?: string;
  @OptionalCodeField() code?: string;
  @IsOptional() @NameField() nameEn?: string;
  @IsOptional() @NameField() nameAr?: string;
  @IsOptional() @IsString() @IsNotEmpty() @Matches(MASTER_COLOR_PATTERN) @Trim() color?: string;
  @IsOptional() @Type(() => Number) @IsInt() @Min(0) @Max(MASTER_SORT_MAX) sortOrder?: number;
  @IsOptional() @IsBoolean() isActive?: boolean;
}

// ---------- RACI Templates ----------
export class RaciItemDto {
  @IsUUID() roleTypeId!: string;
  @IsIn(['R', 'A', 'C', 'I']) responsibility!: 'R' | 'A' | 'C' | 'I';
}
export class CreateRaciTemplateDto {
  @CodeField() code!: string;
  @NameField() nameEn!: string;
  @NameField() nameAr!: string;
  @OptionalTextField() description?: string;
  @OptionalTextField(MASTER_PROCESS_TYPE_MAX) processType?: string;
  @IsOptional() @IsBoolean() isActive?: boolean;
  @IsArray() @ArrayMinSize(1) @ArrayUnique((item: RaciItemDto) => item.roleTypeId) @ValidateNested({ each: true }) @Type(() => RaciItemDto) items!: RaciItemDto[];
}
export class UpdateRaciTemplateDto {
  @OptionalCodeField() code?: string;
  @IsOptional() @NameField() nameEn?: string;
  @IsOptional() @NameField() nameAr?: string;
  @OptionalTextField() description?: string;
  @OptionalTextField(MASTER_PROCESS_TYPE_MAX) processType?: string;
  @IsOptional() @IsBoolean() isActive?: boolean;
  @IsOptional() @IsArray() @ArrayMinSize(1) @ArrayUnique((item: RaciItemDto) => item.roleTypeId) @ValidateNested({ each: true }) @Type(() => RaciItemDto) items?: RaciItemDto[];
}
