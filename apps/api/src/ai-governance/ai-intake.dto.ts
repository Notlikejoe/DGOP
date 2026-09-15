import { Type } from 'class-transformer';
import { ArrayMaxSize, ArrayMinSize, IsArray, IsUUID, IsIn, IsInt, IsObject, IsOptional, IsString, MaxLength, Min } from 'class-validator';

export class CreateAiIntakeDraftDto {
  @IsOptional()
  @IsObject()
  payload?: Record<string, unknown>;
}

export class UpdateAiIntakeDraftDto {
  @Type(() => Number)
  @IsInt()
  @Min(1)
  expectedVersion!: number;

  @IsObject()
  changes!: Record<string, unknown>;
}

export class SubmitAiIntakeDto {
  @Type(() => Number)
  @IsInt()
  @Min(1)
  expectedVersion!: number;
}

export class TriageAiIntakeDto extends SubmitAiIntakeDto {
  @IsString()
  @IsIn(['accept', 'return', 'reject'])
  decision!: 'accept' | 'return' | 'reject';

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  justification?: string;
}
export class CloseAiIntakeDto extends SubmitAiIntakeDto {
 @IsIn(['withdraw','closed_no_action']) mode!:'withdraw'|'closed_no_action';
 @IsString() @MaxLength(5000) justification!:string;
 @IsArray() @ArrayMinSize(1) @ArrayMaxSize(20) @IsUUID('4',{each:true}) evidenceIds!:string[];
}
