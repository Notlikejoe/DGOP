import { ArrayMaxSize, ArrayMinSize, IsArray, IsIn, IsOptional, IsString, IsUUID, MaxLength } from 'class-validator';
import { AiRiskVersionDto } from './ai-risk-intake.dto';

export class DecideResidualRiskDto extends AiRiskVersionDto {
  @IsIn(['approve','return','accept','restrict','stop']) decision!: 'approve'|'return'|'accept'|'restrict'|'stop';
  @IsString() @MaxLength(5000) justification!: string;
  @IsArray() @ArrayMinSize(1) @ArrayMaxSize(20) @IsUUID('4',{each:true}) evidenceIds!: string[];
  @IsOptional() @IsArray() @ArrayMaxSize(20) @IsString({each:true}) @MaxLength(5000,{each:true}) conditions?: string[];
}
