import { IsArray, IsIn, IsOptional, IsString, IsUUID, ArrayMaxSize, ArrayMinSize, MaxLength } from 'class-validator';
import { ReturnAiClassificationDto } from './ai-classification.dto';

export const AIUC_DECISION_OUTCOMES = ['approve', 'approve_with_conditions', 'return', 'reject', 'restrict', 'stop'] as const;
export type AiucDecisionOutcome = typeof AIUC_DECISION_OUTCOMES[number];

export class RecordAiucDecisionDto extends ReturnAiClassificationDto {
  @IsIn(AIUC_DECISION_OUTCOMES)
  decision!: AiucDecisionOutcome;

  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(20)
  @IsUUID('4', { each: true })
  evidenceIds!: string[];

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(20)
  @IsString({ each: true })
  @MaxLength(1000, { each: true })
  conditions?: string[];
}
