import { Type } from 'class-transformer';
import { IsBoolean, IsIn, IsInt, IsOptional, IsString, Min } from 'class-validator';
import {
  ComplianceCalendarStatus,
  ComplianceCalendarType,
  GovernanceEscalationStatus,
} from '@prisma/client';

export class CreateComplianceCalendarTemplateDto {
  @IsString() title!: string;
  @IsIn(Object.values(ComplianceCalendarType)) type!: ComplianceCalendarType;
  @IsString() cadence!: string;
  @IsOptional() @IsString() ownerRoleCode?: string;
  @IsString() nextRunAt!: string;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) defaultSlaBusinessDays?: number;
}

export class UpdateComplianceCalendarTemplateDto {
  @IsOptional() @IsString() title?: string;
  @IsOptional() @IsString() cadence?: string;
  @IsOptional() @IsString() ownerRoleCode?: string;
  @IsOptional() @IsString() nextRunAt?: string;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) defaultSlaBusinessDays?: number;
  @IsOptional() @IsIn(Object.values(ComplianceCalendarStatus)) status?: ComplianceCalendarStatus;
}

export class CreateKsaHolidayDto {
  @IsString() date!: string;
  @IsString() nameEn!: string;
  @IsOptional() @IsString() nameAr?: string;
  @IsOptional() @IsBoolean() isRecurring?: boolean;
}

export class UpdateEscalationDto {
  @IsIn(Object.values(GovernanceEscalationStatus))
  status!: GovernanceEscalationStatus;
}
