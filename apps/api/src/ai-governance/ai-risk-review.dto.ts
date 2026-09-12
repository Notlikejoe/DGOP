import { ArrayMaxSize, ArrayMinSize, IsArray, IsIn, IsString, IsUUID, MaxLength } from 'class-validator';
import { AiRiskVersionDto } from './ai-risk-intake.dto';

export class CompleteAiRiskReviewDto extends AiRiskVersionDto {
  @IsString() @MaxLength(5000) justification!: string;
  @IsArray() @ArrayMinSize(1) @ArrayMaxSize(20) @IsUUID('4', { each: true }) evidenceIds!: string[];
}

export const REASSESSMENT_TRIGGERS=['material_change','provider_change','data_change','incident','nonconformity','regulatory_change','detected_deviation'] as const;
export class ReassessAiRiskDto extends CompleteAiRiskReviewDto {
  @IsIn(REASSESSMENT_TRIGGERS) triggerCode!: typeof REASSESSMENT_TRIGGERS[number];
}
