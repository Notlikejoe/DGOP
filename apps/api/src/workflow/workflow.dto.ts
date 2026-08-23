import {
  IsDateString,
  IsBoolean,
  IsEnum,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsObject,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Matches,
  Min,
} from 'class-validator';
import { Type } from 'class-transformer';
import {
  CaseStatus,
  TaskDecision,
  TaskStatus,
  WorkflowAttachmentKind,
  WorkflowDelegationStatus,
  WorkflowSlaBreachPolicy,
} from '@prisma/client';
import { WORKFLOW_CASE_TYPES, WORKFLOW_RETURN_FOR_CLARIFICATION, WORKFLOW_TASK_TYPES, type WorkflowDecisionValue } from './workflow.logic';

export class CreateCaseDto {
  @IsString() @IsNotEmpty() title!: string;
  @IsOptional() @IsString() description?: string | null;
  @IsOptional() @IsIn(WORKFLOW_CASE_TYPES) type?: string;
  @IsOptional() @IsString() templateId?: string | null;
  @IsOptional() @IsString() assetId?: string | null;
}

export class WorkflowRoutePreviewDto {
  @IsOptional() @IsIn(WORKFLOW_CASE_TYPES) caseType?: string | null;
  @IsOptional() @IsString() assetId?: string | null;
  @IsOptional() @IsString() domainId?: string | null;
  @IsOptional() @IsString() templateId?: string | null;
}

export class CreateWorkflowTemplateDto {
  @IsOptional() @IsString() code?: string | null;
  @IsIn(WORKFLOW_CASE_TYPES) caseType!: string;
  @IsString() @IsNotEmpty() nameEn!: string;
  @IsOptional() @IsString() nameAr?: string | null;
  @IsOptional() @IsString() description?: string | null;
  @IsOptional() @IsString() trigger?: string | null;
  @IsOptional() @IsString() domainId?: string | null;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(365) defaultSlaDays?: number;
  @IsOptional() @IsString() bpmnXml?: string | null;
}

export class SaveWorkflowBpmnDto {
  @IsString() @IsNotEmpty() bpmnXml!: string;
  @IsOptional() @IsString() changeSummary?: string | null;
  @IsOptional() @IsBoolean() acknowledgeMigrationRisk?: boolean;
}

export class UpsertWorkflowVariableDto {
  @IsString() @IsNotEmpty() @MaxLength(120) @Matches(/^[A-Za-z][A-Za-z0-9_.-]*$/) code!: string;
  @IsString() @IsNotEmpty() @MaxLength(220) nameEn!: string;
  @IsOptional() @IsString() @MaxLength(220) nameAr?: string | null;
  @IsOptional() @IsString() @MaxLength(1200) description?: string | null;
  @IsIn(['text', 'number', 'boolean', 'date', 'user', 'role', 'list']) variableType!: string;
  @IsOptional() @IsIn(['case', 'workflow', 'task', 'node', 'asset', 'actor']) scope?: string;
  @IsOptional() @IsIn(['designer', 'initiation_form', 'task_form', 'automation', 'calculated', 'system', 'runtime']) source?: string;
  @IsOptional() defaultValue?: unknown;
  @IsOptional() allowedValues?: unknown[];
  @IsOptional() @IsBoolean() isRequired?: boolean;
}

export class WorkflowTemplateReviewDto {
  @IsOptional() @IsString() bpmnXml?: string | null;
  @IsOptional() @IsString() @MaxLength(1200) comment?: string | null;
}

export class WorkflowTemplateLifecycleDto {
  @IsIn(['activate', 'suspend', 'retire', 'archive', 'delete_draft']) action!: string;
  @IsOptional() @IsString() @MaxLength(1200) reason?: string | null;
}

export class WorkflowCaseControlDto {
  @IsOptional() @IsString() @MaxLength(1200) reason?: string | null;
}

export class WorkflowDesignerSimulationDto {
  @IsOptional() @IsString() bpmnXml?: string | null;
  @IsOptional() @IsObject() decisions?: Record<string, string | null>;
}

export class WorkflowDesignerTestRunDto {
  @IsOptional() @IsString() bpmnXml?: string | null;
  @IsOptional() @IsObject() decisions?: Record<string, string | null>;
  @IsOptional() @IsObject() variables?: Record<string, unknown>;
  @IsOptional() @IsIn(['dev', 'test', 'uat', 'demo']) environment?: string;
}

export class ListWorkflowDesignerTestRunsDto {
  @IsOptional() @IsIn(['ready', 'warning', 'blocked', 'reset']) status?: string;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) page?: number;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(50) pageSize?: number;
}

export class WorkflowDesignerMigrationPreviewDto {
  @IsOptional() @IsString() bpmnXml?: string | null;
  @IsOptional() @IsString() changeSummary?: string | null;
}

export class WorkflowTemplateRollbackDto {
  @Type(() => Number) @IsInt() @Min(1) version!: number;
  @IsOptional() @IsString() changeSummary?: string | null;
}

export class WorkflowTemplateMigrationExecuteDto {
  @IsOptional() @IsString() fallbackStageCode?: string | null;
  @IsOptional() @IsBoolean() dryRun?: boolean;
}

export class ListWorkflowCasesDto {
  @IsOptional() @IsEnum(CaseStatus) status?: CaseStatus;
  @IsOptional() @IsIn(WORKFLOW_CASE_TYPES) type?: string;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) page?: number;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(200) pageSize?: number;
}

export class WorkflowOperationsReportQueryDto {
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(366) periodDays?: number;
  @IsOptional() @IsString() templateId?: string | null;
  @IsOptional() @IsIn(WORKFLOW_CASE_TYPES) caseType?: string;
  @IsOptional() @IsEnum(CaseStatus) status?: CaseStatus;
  @IsOptional() @IsString() @MaxLength(220) ownerEmail?: string;
  @IsOptional() @IsString() orgUnitId?: string | null;
}

export class UpdateCaseDto {
  @IsOptional() @IsString() @IsNotEmpty() title?: string;
  @IsOptional() @IsString() description?: string | null;
  @IsOptional() @IsEnum(CaseStatus) status?: CaseStatus;
}

export class AddTaskDto {
  @IsString() @IsNotEmpty() title!: string;
  @IsOptional() @IsIn(WORKFLOW_TASK_TYPES) type?: string;
  @IsOptional() @IsString() assigneeUserId?: string | null;
  @IsOptional() @IsDateString() dueDate?: string | null;
}

export class ListMyTasksDto {
  @IsOptional() @IsIn(['open', ...Object.values(TaskStatus)]) status?: string;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) page?: number;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(200) pageSize?: number;
}

export class UpdateTaskDto {
  @IsOptional() @IsString() @IsNotEmpty() title?: string;
  @IsOptional() @IsString() assigneeUserId?: string | null;
  @IsOptional() @IsDateString() dueDate?: string | null;
}

export class DecisionDto {
  @IsIn([...Object.values(TaskDecision), WORKFLOW_RETURN_FOR_CLARIFICATION]) decision!: WorkflowDecisionValue;
  @IsOptional() @IsString() comment?: string | null;
}

export class SubmitWorkflowTaskFormDto {
  @IsObject() data!: Record<string, unknown>;
}

export class SaveWorkflowTaskFormDraftDto {
  @IsObject() data!: Record<string, unknown>;
}

export class SubmitAssignmentDto {
  @IsString() @IsNotEmpty() assignmentId!: string;
  @IsString() @IsNotEmpty() approverUserId!: string;
  @IsOptional() @IsDateString() dueDate?: string | null;
}

export class AddWorkflowCommentDto {
  @IsString() @IsNotEmpty() @MaxLength(2000) body!: string;
  @IsOptional() @IsString() @MaxLength(40) visibility?: string;
  @IsOptional() @IsString() taskId?: string | null;
}

export class UploadWorkflowAttachmentDto {
  @IsOptional() @IsEnum(WorkflowAttachmentKind) kind?: WorkflowAttachmentKind;
  @IsOptional() @IsUUID('4') taskId?: string | null;
}

export class CreateWorkflowDelegationDto {
  @IsString() @IsNotEmpty() delegatorUserId!: string;
  @IsString() @IsNotEmpty() delegateUserId!: string;
  @IsString() @IsNotEmpty() @MaxLength(80) roleCode!: string;
  @IsOptional() @IsString() assetId?: string | null;
  @IsString() @IsNotEmpty() @MaxLength(800) reason!: string;
  @IsDateString() startsAt!: string;
  @IsDateString() expiresAt!: string;
}

export class UpdateWorkflowDelegationDto {
  @IsEnum(WorkflowDelegationStatus) status!: WorkflowDelegationStatus;
}

export class UpsertWorkflowSlaTemplateDto {
  @IsString() @IsNotEmpty() @MaxLength(120) code!: string;
  @IsIn(WORKFLOW_CASE_TYPES) caseType!: string;
  @IsOptional() @IsString() @MaxLength(80) stageKind?: string | null;
  @Type(() => Number) @IsInt() @Min(1) @Max(365) targetBusinessDays!: number;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100) warningAtPercent?: number;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100) escalationAtPercent?: number;
  @IsOptional() @IsEnum(WorkflowSlaBreachPolicy) breachPolicy?: WorkflowSlaBreachPolicy;
  @IsOptional() @IsString() @MaxLength(80) targetRoleCode?: string | null;
  @IsOptional() @IsString() @MaxLength(80) calendarCode?: string;
  @IsOptional() @IsBoolean() isActive?: boolean;
}
