import { ArrayMaxSize, ArrayMinSize, IsArray, IsInt, IsOptional, IsString, IsUUID, Matches, MaxLength, Min, MinLength } from 'class-validator';

export class RegisterAnnualReviewDto {
  @IsUUID('4') organizationUnitId!:string;
}
export class CompleteAnnualReviewDto {
  @IsOptional() @IsInt() @Min(0) expectedHandoverRound?:number;
  @IsInt() @Min(1) expectedRound!:number;
  @IsString() @MinLength(1) @MaxLength(5000) trendsSummary!:string;
  @IsString() @MinLength(1) @MaxLength(5000) controlEffectivenessSummary!:string;
  @IsString() @MinLength(1) @MaxLength(5000) nonconformitySummary!:string;
  @IsArray() @ArrayMinSize(1) @ArrayMaxSize(20) @IsUUID('4',{each:true}) evidenceIds!:string[];
}
export class HandoverAnnualReviewDto {
  @IsInt() @Min(0) expectedHandoverRound!:number;
  @IsUUID('4') toOfficerId!:string;
  @IsString() @MinLength(1) @MaxLength(5000) justification!:string;
  @IsArray() @ArrayMinSize(1) @ArrayMaxSize(20) @IsUUID('4',{each:true}) evidenceIds!:string[];
}
export class CaptureMonthlyReviewDto extends RegisterAnnualReviewDto {
  @IsString() @Matches(/^\d{4}-(0[1-9]|1[0-2])$/u) periodMonth!:string;
}
