import { ArrayMaxSize, ArrayMinSize, IsArray, IsInt, IsString, IsUUID, MaxLength, Min, MinLength } from 'class-validator';

export class RegisterAnnualReviewDto {
  @IsUUID('4') organizationUnitId!:string;
}
export class CompleteAnnualReviewDto {
  @IsInt() @Min(1) expectedRound!:number;
  @IsString() @MinLength(1) @MaxLength(5000) trendsSummary!:string;
  @IsString() @MinLength(1) @MaxLength(5000) controlEffectivenessSummary!:string;
  @IsString() @MinLength(1) @MaxLength(5000) nonconformitySummary!:string;
  @IsArray() @ArrayMinSize(1) @ArrayMaxSize(20) @IsUUID('4',{each:true}) evidenceIds!:string[];
}
