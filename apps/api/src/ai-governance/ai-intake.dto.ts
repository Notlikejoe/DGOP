import { Type } from 'class-transformer';
import { IsIn, IsInt, IsObject, IsOptional, IsString, MaxLength, Min } from 'class-validator';

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
