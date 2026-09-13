import { IsBoolean, IsIn, IsInt, IsString, IsUUID, Min, MaxLength, IsArray, ArrayMinSize, ArrayMaxSize } from 'class-validator';
export class CaptureDashboardDto {
 @IsUUID('4') organizationUnitId!:string;
 @IsIn(['manual','daily','monthly']) frequency!: 'manual'|'daily'|'monthly';
}
export class ConfigureDashboardScheduleDto {
 @IsInt() @Min(0) expectedRound!:number;
 @IsBoolean() dailyEnabled!:boolean;
 @IsBoolean() monthlyEnabled!:boolean;
 @IsString() @MaxLength(5000) justification!:string;
 @IsArray() @ArrayMinSize(1) @ArrayMaxSize(20) @IsUUID('4',{each:true}) evidenceIds!:string[];
}
