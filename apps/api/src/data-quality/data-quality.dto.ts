import {
  IsDateString,
  IsArray,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsObject,
  IsOptional,
  IsString,
  Max,
  Min,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';

export const DQ_STATUSES = ['open', 'triaged', 'in_progress', 'resolved', 'closed', 'cancelled'] as const;
export const DQ_SEVERITIES = ['low', 'medium', 'high', 'critical'] as const;
export const DQ_DIMENSIONS = ['completeness', 'accuracy', 'validity', 'consistency', 'timeliness', 'uniqueness'] as const;
export const DQ_PRIORITIES = ['P1', 'P2', 'P3', 'P4'] as const;
export const DQ_RULE_STATUSES = ['draft', 'in_review', 'approved', 'deployed', 'retired'] as const;
export const DQ_RCA_TEMPLATES = ['five_whys', 'fishbone', 'process_map', 'lineage_analysis'] as const;

export type DqStatus = (typeof DQ_STATUSES)[number];
export type DqSeverity = (typeof DQ_SEVERITIES)[number];
export type DqDimension = (typeof DQ_DIMENSIONS)[number];
export type DqPriority = (typeof DQ_PRIORITIES)[number];
export type DqRuleStatus = (typeof DQ_RULE_STATUSES)[number];
export type DqRcaTemplate = (typeof DQ_RCA_TEMPLATES)[number];

export class CreateDataQualityIssueDto {
  @IsOptional() @IsString() code?: string;
  @IsString() @IsNotEmpty() title!: string;
  @IsOptional() @IsString() description?: string | null;
  @IsOptional() @IsIn(DQ_SEVERITIES) severity?: DqSeverity;
  @IsOptional() @IsIn(DQ_PRIORITIES) priority?: DqPriority;
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
  @IsOptional() @IsIn(DQ_PRIORITIES) priority?: DqPriority;
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

export class CreateDataQualityRuleDto {
  @IsOptional() @IsString() code?: string;
  @IsString() @IsNotEmpty() nameEn!: string;
  @IsString() @IsNotEmpty() nameAr!: string;
  @IsOptional() @IsString() description?: string | null;
  @IsOptional() @IsIn(DQ_DIMENSIONS) dimension?: DqDimension;
  @IsOptional() @IsIn(DQ_SEVERITIES) severity?: DqSeverity;
  @IsOptional() @IsString() assetId?: string | null;
  @IsOptional() @IsString() domainId?: string | null;
  @IsOptional() @IsString() ownerPersonId?: string | null;
  @IsOptional() @IsString() thresholdExpression?: string | null;
  @IsOptional() @IsString() checkFrequency?: string;
  @IsOptional() @IsString() impactSummary?: string | null;
  @IsOptional() @IsObject() definitionJson?: Record<string, unknown> | null;
}

export class UpdateDataQualityRuleDto {
  @IsOptional() @IsString() @IsNotEmpty() nameEn?: string;
  @IsOptional() @IsString() @IsNotEmpty() nameAr?: string;
  @IsOptional() @IsString() description?: string | null;
  @IsOptional() @IsIn(DQ_DIMENSIONS) dimension?: DqDimension;
  @IsOptional() @IsIn(DQ_SEVERITIES) severity?: DqSeverity;
  @IsOptional() @IsString() assetId?: string | null;
  @IsOptional() @IsString() domainId?: string | null;
  @IsOptional() @IsString() ownerPersonId?: string | null;
  @IsOptional() @IsString() thresholdExpression?: string | null;
  @IsOptional() @IsString() checkFrequency?: string;
  @IsOptional() @IsString() impactSummary?: string | null;
  @IsOptional() @IsObject() definitionJson?: Record<string, unknown> | null;
  @IsOptional() @IsString() changeSummary?: string | null;
}

export class DataQualityRuleTransitionDto {
  @IsOptional() @IsString() comment?: string | null;
}

export class DataQualityProfileColumnDto {
  @IsString() @IsNotEmpty() columnName!: string;
  @IsOptional() @IsString() dataType?: string | null;
  @IsOptional() @IsInt() @Min(0) @Max(100) completenessPct?: number;
  @IsOptional() @IsInt() @Min(0) @Max(100) uniquenessPct?: number;
  @IsOptional() @IsInt() @Min(0) @Max(100) validityPct?: number;
  @IsOptional() @IsString() pattern?: string | null;
  @IsOptional() @IsInt() @Min(0) anomalyCount?: number;
  @IsOptional() @IsString() recommendation?: string | null;
  @IsOptional() @IsIn(DQ_DIMENSIONS) dimension?: DqDimension | null;
}

export class ImportDataQualityProfileDto {
  @IsOptional() @IsString() assetId?: string | null;
  @IsOptional() @IsString() domainId?: string | null;
  @IsOptional() @IsString() source?: string;
  @IsOptional() @IsInt() @Min(0) rowCount?: number;
  @IsArray() @ValidateNested({ each: true }) @Type(() => DataQualityProfileColumnDto)
  columns!: DataQualityProfileColumnDto[];
  @IsOptional() @IsObject() summaryJson?: Record<string, unknown> | null;
}

export class UpsertDataQualityRcaDto {
  @IsOptional() @IsIn(DQ_RCA_TEMPLATES) template?: DqRcaTemplate;
  @IsOptional() @IsString() summary?: string | null;
  @IsOptional() @IsString() why1?: string | null;
  @IsOptional() @IsString() why2?: string | null;
  @IsOptional() @IsString() why3?: string | null;
  @IsOptional() @IsString() why4?: string | null;
  @IsOptional() @IsString() why5?: string | null;
  @IsOptional() @IsObject() fishboneJson?: Record<string, unknown> | null;
  @IsOptional() @IsString() processMap?: string | null;
  @IsOptional() @IsString() lineageNotes?: string | null;
  @IsOptional() @IsString() rootCause?: string | null;
  @IsOptional() @IsString() remediationPlan?: string | null;
  @IsOptional() @IsString() validationResult?: string | null;
}
