import {
  IsDateString,
  IsEnum,
  IsNotEmpty,
  IsOptional,
  IsString,
} from 'class-validator';
import { CaseStatus, TaskDecision } from '@prisma/client';

export class CreateCaseDto {
  @IsString() @IsNotEmpty() title!: string;
  @IsOptional() @IsString() description?: string | null;
  /** general | owner_assignment_approval | steward_assignment_approval. */
  @IsOptional() @IsString() type?: string;
  @IsOptional() @IsString() assetId?: string | null;
}

export class UpdateCaseDto {
  @IsOptional() @IsString() @IsNotEmpty() title?: string;
  @IsOptional() @IsString() description?: string | null;
  @IsOptional() @IsEnum(CaseStatus) status?: CaseStatus;
}

export class AddTaskDto {
  @IsString() @IsNotEmpty() title!: string;
  /** approval | review | information. */
  @IsOptional() @IsString() type?: string;
  @IsOptional() @IsString() assigneeUserId?: string | null;
  @IsOptional() @IsDateString() dueDate?: string | null;
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
