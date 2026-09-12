import { Type } from 'class-transformer';
import { ArrayMaxSize, ArrayMinSize, IsArray, IsIn, IsInt, IsNotEmpty, IsObject, IsOptional, IsString, IsUUID, Min } from 'class-validator';

export class CreateAiClassificationDto {
  @Type(() => Number)
  @IsInt()
  @Min(1)
  expectedVersion!: number;

  @IsObject()
  input!: Record<string, unknown>;
}

export class VerifyAiClassificationDto {
  @Type(() => Number)
  @IsInt()
  @Min(1)
  expectedVersion!: number;

  @IsOptional()
  @IsString()
  justification?: string;
}

export class ReturnAiClassificationDto {
  @Type(() => Number)
  @IsInt()
  @Min(1)
  expectedVersion!: number;

  @IsString()
  @IsNotEmpty()
  justification!: string;
}

export class OverrideAiClassificationDto extends ReturnAiClassificationDto {
  @IsString()
  @IsNotEmpty()
  approvedTierCode!: string;

  @IsArray()
  @ArrayMaxSize(20)
  @IsUUID('4', { each: true })
  evidenceIds!: string[];

  @IsString()
  @IsNotEmpty()
  authorityReference!: string;
}

export class UnacceptableAiClassificationDto extends ReturnAiClassificationDto {
  @IsArray()
  @ArrayMaxSize(20)
  @IsUUID('4', { each: true })
  evidenceIds!: string[];

  @IsString()
  @IsNotEmpty()
  authorityReference!: string;
}

export class ReviewAiClassificationGateDto extends ReturnAiClassificationDto {
  @IsIn(['approve', 'return', 'reject'])
  decision!: 'approve' | 'return' | 'reject';

  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(20)
  @IsUUID('4', { each: true })
  evidenceIds!: string[];
}
