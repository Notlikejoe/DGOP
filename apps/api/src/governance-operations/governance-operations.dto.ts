import { Type } from 'class-transformer';
import { IsBoolean, IsEmail, IsIn, IsInt, IsOptional, IsString, MaxLength, Min } from 'class-validator';
import {
  ComplianceCalendarStatus,
  ComplianceCalendarType,
  GovernanceEscalationStatus,
  GovernanceNotificationSeverity,
  GovernanceNotificationStatus,
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

export class CreateGovernanceNotificationDto {
  @IsString() @MaxLength(180) title!: string;
  @IsString() @MaxLength(1200) message!: string;
  @IsOptional() @IsIn(Object.values(GovernanceNotificationSeverity)) severity?: GovernanceNotificationSeverity;
  @IsOptional() @IsString() @MaxLength(80) sourceType?: string;
  @IsOptional() @IsString() @MaxLength(120) sourceId?: string;
  @IsOptional() @IsString() @MaxLength(160) dedupeKey?: string;
  @IsOptional() @IsString() targetRoleCode?: string;
  @IsOptional() @IsString() assigneeUserId?: string;
  @IsOptional() @IsString() workflowCaseId?: string;
  @IsOptional() @IsString() workflowTaskId?: string;
  @IsOptional() @IsEmail() emailTo?: string;
}

export class UpdateNotificationDto {
  @IsIn(Object.values(GovernanceNotificationStatus))
  status!: GovernanceNotificationStatus;
}

export class DispatchNotificationsDto {
  @IsOptional() @IsBoolean() dryRun?: boolean;
}
