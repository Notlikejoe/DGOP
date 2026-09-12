import { ArrayMaxSize, ArrayMinSize, IsArray, IsIn, IsOptional, IsString, IsUUID, MaxLength } from 'class-validator';
import { RecordAiucDecisionDto } from './ai-decision.dto';
import { ReturnAiClassificationDto } from './ai-classification.dto';

export const AI_PRODUCT_SUBTYPES = ['ai_powered_application', 'prediction_service', 'recommendation_system'] as const;

export class ProposeAiRegistrationDto extends ReturnAiClassificationDto {
  @IsIn(['create', 'link']) mode!: 'create' | 'link';
  @IsOptional() @IsUUID('4') existingAssetId?: string;
  @IsOptional() @IsString() @MaxLength(180) nameEn?: string;
  @IsOptional() @IsString() @MaxLength(180) nameAr?: string;
  @IsOptional() @IsIn(AI_PRODUCT_SUBTYPES) assetSubtype?: string;
  @IsUUID('4') classificationId!: string;
  @IsUUID('4') domainId!: string;
}

export class ApproveAiRegistrationDto extends ReturnAiClassificationDto {
  @IsIn(['approve', 'return']) decision!: 'approve' | 'return';
  // Reuse the final-decision evidence contract without accepting its outcomes/conditions.
  @IsArray() @ArrayMinSize(1) @ArrayMaxSize(20) @IsUUID('4', { each: true }) evidenceIds!: RecordAiucDecisionDto['evidenceIds'];
}
