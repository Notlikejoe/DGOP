import { ArrayMaxSize, ArrayMinSize, IsArray, IsBoolean, IsIn, IsOptional, IsString, IsUUID, MaxLength } from 'class-validator';
import { AiRiskVersionDto } from './ai-risk-intake.dto';
export const RESPONSE_STRATEGIES = ['AVOID','MITIGATE','TRANSFER','ACCEPT','ESCALATE'] as const;
export class ProposeRiskResponseDto extends AiRiskVersionDto {
  @IsIn(RESPONSE_STRATEGIES) strategyCode!: typeof RESPONSE_STRATEGIES[number];
  @IsString() @MaxLength(5000) justification!: string;
  @IsArray() @ArrayMinSize(1) @ArrayMaxSize(20) @IsUUID('4', { each: true }) evidenceIds!: string[];
  @IsBoolean() offshoreProcessing!: boolean;
  @IsOptional() @IsString() @MaxLength(400) provider?: string;
  @IsOptional() @IsArray() @ArrayMaxSize(20) @IsUUID('4', { each: true }) contractEvidenceIds?: string[];
}
