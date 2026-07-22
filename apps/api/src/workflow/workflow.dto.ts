import {
  IsDateString,
  IsEnum,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsObject,
  IsOptional,
  IsString,
  Max,
  Min,
} from 'class-validator';
import { Type } from 'class-transformer';
import { CaseStatus, TaskDecision, TaskStatus } from '@prisma/client';
import { WORKFLOW_CASE_TYPES, WORKFLOW_TASK_TYPES } from './workflow.logic';

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
}

export class WorkflowDesignerSimulationDto {
  @IsOptional() @IsString() bpmnXml?: string | null;
  @IsOptional() @IsObject() decisions?: Record<string, string | null>;
}

export class WorkflowDesignerMigrationPreviewDto {
  @IsOptional() @IsString() bpmnXml?: string | null;
  @IsOptional() @IsString() changeSummary?: string | null;
}

export class ListWorkflowCasesDto {
  @IsOptional() @IsEnum(CaseStatus) status?: CaseStatus;
  @IsOptional() @IsIn(WORKFLOW_CASE_TYPES) type?: string;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) page?: number;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(200) pageSize?: number;
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
  @IsEnum(TaskDecision) decision!: TaskDecision;
  @IsOptional() @IsString() comment?: string | null;
}

export class SubmitAssignmentDto {
  @IsString() @IsNotEmpty() assignmentId!: string;
  @IsString() @IsNotEmpty() approverUserId!: string;
  @IsOptional() @IsDateString() dueDate?: string | null;
}
