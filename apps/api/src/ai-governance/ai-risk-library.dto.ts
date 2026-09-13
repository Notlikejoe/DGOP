import { ArrayMaxSize, ArrayMinSize, IsArray, IsInt, IsObject, IsOptional, IsString, IsUUID, MaxLength, Min } from 'class-validator';
export class PublishRiskLibraryDto {
 @IsString() @MaxLength(5000) justification!:string;
 @IsArray() @ArrayMinSize(1) @ArrayMaxSize(20) @IsUUID('4',{each:true}) evidenceIds!:string[];
}
export class ProposeRiskLibraryDto extends PublishRiskLibraryDto {
 @IsOptional() @IsUUID('4') entryId?:string;
 @IsInt() @Min(0) expectedRound!:number;
 @IsObject() content!:Record<string,unknown>;
}
export class CreateAiRiskDto {
 @IsUUID('4') useCaseId!:string;
 @IsUUID('4') initiationKey!:string;
 @IsOptional() @IsUUID('4') libraryVersionId?:string;
 @IsString() @MaxLength(5000) justification!:string;
}
