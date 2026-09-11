import { Type } from 'class-transformer';
import { IsInt, IsObject, IsOptional, Min } from 'class-validator';

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
