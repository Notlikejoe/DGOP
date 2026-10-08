import { Type } from 'class-transformer';
import { ArrayMaxSize,ArrayMinSize,IsArray,IsIn,IsInt,IsObject,IsOptional,IsString,IsUUID,Max,MaxLength,Min } from 'class-validator';
export class LifecycleVersionDto { @Type(()=>Number) @IsInt() @Min(1) expectedVersion!:number; }
export class ProposeAiLifecycleDto extends LifecycleVersionDto {
 @IsIn(['change','suspend','resume','retire']) action!:'change'|'suspend'|'resume'|'retire';
 @IsString() @MaxLength(5000) justification!:string;
 @IsOptional() @IsObject() changes?:Record<string,unknown>;
 @IsObject() assignments!:Record<string,string>;
}
export class AssessAiLifecycleDto extends LifecycleVersionDto {
 @IsString() @MaxLength(5000) justification!:string;
 @IsOptional() @IsObject() input?:Record<string,unknown>;
 @IsOptional() @Type(()=>Number) @IsInt() @Min(1) @Max(4) score?:number;
}
export class DecideAiLifecycleDto extends LifecycleVersionDto {
 @IsIn(['approve','return','reject']) decision!:'approve'|'return'|'reject';
 @IsString() @MaxLength(5000) justification!:string;
 @IsArray() @ArrayMinSize(1) @ArrayMaxSize(20) @IsUUID('4',{each:true}) evidenceIds!:string[];
 @IsOptional() @IsArray() @ArrayMaxSize(20) @IsString({each:true}) @MaxLength(1000,{each:true}) conditions?:string[];
}
