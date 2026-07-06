import {
  IsDateString,
  IsIn,
  IsNotEmpty,
  IsOptional,
  IsString,
} from 'class-validator';

export const DQ_STATUSES = ['open', 'triaged', 'in_progress', 'resolved', 'closed', 'cancelled'] as const;
export const DQ_SEVERITIES = ['low', 'medium', 'high', 'critical'] as const;
export const DQ_DIMENSIONS = ['completeness', 'accuracy', 'validity', 'consistency', 'timeliness', 'uniqueness'] as const;

export type DqStatus = (typeof DQ_STATUSES)[number];
export type DqSeverity = (typeof DQ_SEVERITIES)[number];
export type DqDimension = (typeof DQ_DIMENSIONS)[number];

export class CreateDataQualityIssueDto {
  @IsOptional() @IsString() code?: string;
  @IsString() @IsNotEmpty() title!: string;
  @IsOptional() @IsString() description?: string | null;
  @IsOptional() @IsIn(DQ_SEVERITIES) severity?: DqSeverity;
  @IsOptional() @IsIn(DQ_DIMENSIONS) dimension?: DqDimension;
  @IsOptional() @IsString() assetId?: string | null;
  @IsOptional() @IsString() responsiblePersonId?: string | null;
  @IsOptional() @IsDateString() dueDate?: string | null;
  @IsOptional() @IsString() source?: string;
}

export class UpdateDataQualityIssueDto {
  @IsOptional() @IsString() @IsNotEmpty() title?: string;
  @IsOptional() @IsString() description?: string | null;
  @IsOptional() @IsIn(DQ_SEVERITIES) severity?: DqSeverity;
  @IsOptional() @IsIn(DQ_DIMENSIONS) dimension?: DqDimension;
  @IsOptional() @IsIn(DQ_STATUSES) status?: DqStatus;
  @IsOptional() @IsString() assetId?: string | null;
  @IsOptional() @IsString() responsiblePersonId?: string | null;
  @IsOptional() @IsDateString() dueDate?: string | null;
}

export class CloseDataQualityIssueDto {
  @IsString() @IsNotEmpty() resolutionSummary!: string;
}

export class ImportDataQualityIssuesDto {
  @IsString() @IsNotEmpty() csv!: string;
}
