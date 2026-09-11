import { Type } from 'class-transformer';
import { IsInt, IsObject, Min } from 'class-validator';

export class CreateAiClassificationDto {
  @Type(() => Number)
  @IsInt()
  @Min(1)
  expectedVersion!: number;

  @IsObject()
  input!: Record<string, unknown>;
}
