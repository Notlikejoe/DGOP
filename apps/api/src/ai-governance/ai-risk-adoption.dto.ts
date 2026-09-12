import { ArrayMaxSize, ArrayMinSize, IsArray, IsIn, IsString, IsUUID, MaxLength } from 'class-validator';
import { AiRiskVersionDto } from './ai-risk-intake.dto';

export class ReviewRiskAssessmentDto extends AiRiskVersionDto {
  @IsIn(['approve', 'return']) decision!: 'approve' | 'return';
  @IsString() @MaxLength(5000) justification!: string;
  @IsArray() @ArrayMinSize(1) @ArrayMaxSize(20) @IsUUID('4', { each: true }) evidenceIds!: string[];
}
