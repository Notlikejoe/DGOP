import { IsArray, ArrayMaxSize, IsIn, IsInt, Min, Max, IsOptional, IsString, IsUUID, MaxLength } from 'class-validator';
import { AiRiskVersionDto } from './ai-risk-intake.dto';
export const ACTION_TYPES = ['PREVENTIVE','DETECTIVE','CORRECTIVE','IMPROVEMENT'] as const;
export class SaveTreatmentActionDto extends AiRiskVersionDto {
 @IsOptional() @IsArray() @ArrayMaxSize(10) @IsUUID('4',{each:true}) controlVersionIds?:string[];
 @IsString() @MaxLength(200) title!: string;
 @IsString() @MaxLength(5000) description!: string;
 @IsIn(ACTION_TYPES) actionType!: typeof ACTION_TYPES[number];
 @IsString() @MaxLength(80) priorityCode!: string;
 @IsUUID('4') assigneeUserId!: string;
 @IsString() @MaxLength(10) targetDate!: string;
 @IsOptional() @IsString() @MaxLength(10) startDate?: string;
 @IsString() @MaxLength(5000) evidenceRequired!: string;
 @IsArray() @ArrayMaxSize(20) @IsUUID('4',{each:true}) evidenceIds!: string[];
 @IsIn(['investigation','evidence_upload','information']) taskType!: string;
}
export class RecordTreatmentProgressDto extends AiRiskVersionDto {
 @IsInt() @Min(0) @Max(100) completionPct!: number;
 @IsString() @MaxLength(5000) justification!: string;
 @IsArray() @ArrayMaxSize(20) @IsUUID('4',{each:true}) evidenceIds!: string[];
}
