import { Type } from 'class-transformer';
import { ArrayMaxSize, ArrayMinSize, IsArray, IsInt, IsNotEmpty, IsObject, IsOptional, IsString, Matches, MaxLength, Min, ValidateNested } from 'class-validator';
export class AiReferenceValueDto {
  @IsString() @Matches(/^[A-Z][A-Z0-9_]*$/) @MaxLength(100) code!:string;
  @IsString() @IsNotEmpty() @MaxLength(1000) labelAr!:string;
  @IsString() @IsNotEmpty() @MaxLength(1000) labelEn!:string;
  @IsInt() @Min(0) sortOrder!:number;
  @IsOptional() @IsObject() metadata?:Record<string,unknown>;
}
export class AiReferenceDecisionDto {
  @IsString() @IsNotEmpty() @MaxLength(2000) justification!:string;
}
export class ProposeAiReferenceDto extends AiReferenceDecisionDto {
  @IsString() @IsNotEmpty() @MaxLength(200) nameEn!:string;
  @IsString() @IsNotEmpty() @MaxLength(200) nameAr!:string;
  @IsString() @Matches(/^[a-fA-F0-9]{64}$/) sourceSha256!:string;
  @IsString() @IsNotEmpty() @MaxLength(1000) sourceLocator!:string;
  @IsArray() @ArrayMinSize(1) @ArrayMaxSize(1000) @ValidateNested({each:true}) @Type(()=>AiReferenceValueDto)
  values!:AiReferenceValueDto[];
}
