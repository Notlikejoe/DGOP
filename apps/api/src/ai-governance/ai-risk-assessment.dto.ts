import { IsInt, IsString, Max, MaxLength, Min } from 'class-validator';
import { AiRiskVersionDto } from './ai-risk-intake.dto';
export class RiskDimensionScoreDto extends AiRiskVersionDto {
  @IsInt() @Min(1) @Max(4) value!: number;
  @IsString() @MaxLength(5000) justification!: string;
}
export class CompleteRiskAssessmentDto extends AiRiskVersionDto {
  @IsInt() @Min(1) @Max(4) likelihood!: number;
  @IsString() @MaxLength(5000) justification!: string;
}
export class RestartRiskAssessmentDto extends AiRiskVersionDto {
  @IsString() @MaxLength(2000) justification!: string;
}
export class CompleteResidualAssessmentDto extends CompleteRiskAssessmentDto {
  @IsString() @MaxLength(80) controlEffectivenessCode!: string;
  @IsString() @MaxLength(5000) currentControls!: string;
}
