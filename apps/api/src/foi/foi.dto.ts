import {
  FoiAppealStatus,
  FoiDecisionOutcome,
  FoiDisclosureMethod,
  FoiRequestCategory,
  FoiRequestChannel,
  FoiRequesterType,
  FoiRequestStatus,
  FoiReviewStatus,
  FoiReviewType,
} from '@prisma/client';
import {
  IsBoolean,
  IsDateString,
  IsEmail,
  IsEnum,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUrl,
} from 'class-validator';

export class CreateFoiRequestDto {
  @IsString() @IsNotEmpty() requesterName!: string;
  @IsOptional() @IsEmail() requesterEmail?: string | null;
  @IsOptional() @IsString() requesterPhone?: string | null;
  @IsOptional() @IsEnum(FoiRequesterType) requesterType?: FoiRequesterType;
  @IsOptional() @IsEnum(FoiRequestChannel) channel?: FoiRequestChannel;
  @IsOptional() @IsEnum(FoiRequestCategory) category?: FoiRequestCategory;
  @IsString() @IsNotEmpty() subject!: string;
  @IsString() @IsNotEmpty() description!: string;
  @IsOptional() @IsDateString() receivedAt?: string | null;
  @IsOptional() @IsBoolean() identityValidated?: boolean;
  @IsOptional() @IsBoolean() contactValidated?: boolean;
  @IsOptional() @IsString() assignedOfficerPersonId?: string | null;
  @IsOptional() @IsString() assetId?: string | null;
  @IsOptional() @IsString() dataDomainId?: string | null;
  @IsOptional() @IsString() classificationId?: string | null;
}

export class UpdateFoiRequestDto {
  @IsOptional() @IsString() @IsNotEmpty() requesterName?: string;
  @IsOptional() @IsEmail() requesterEmail?: string | null;
  @IsOptional() @IsString() requesterPhone?: string | null;
  @IsOptional() @IsEnum(FoiRequesterType) requesterType?: FoiRequesterType;
  @IsOptional() @IsEnum(FoiRequestChannel) channel?: FoiRequestChannel;
  @IsOptional() @IsEnum(FoiRequestCategory) category?: FoiRequestCategory;
  @IsOptional() @IsString() @IsNotEmpty() subject?: string;
  @IsOptional() @IsString() description?: string;
  @IsOptional() @IsDateString() receivedAt?: string | null;
  @IsOptional() @IsDateString() dueAt?: string | null;
  @IsOptional() @IsEnum(FoiRequestStatus) status?: FoiRequestStatus;
  @IsOptional() @IsBoolean() identityValidated?: boolean;
  @IsOptional() @IsBoolean() contactValidated?: boolean;
  @IsOptional() @IsString() assignedOfficerPersonId?: string | null;
  @IsOptional() @IsString() assetId?: string | null;
  @IsOptional() @IsString() dataDomainId?: string | null;
  @IsOptional() @IsString() classificationId?: string | null;
}

export class SaveFoiReviewDto {
  @IsEnum(FoiReviewType) reviewType!: FoiReviewType;
  @IsOptional() @IsEnum(FoiReviewStatus) status?: FoiReviewStatus;
  @IsOptional() @IsString() reviewerPersonId?: string | null;
  @IsOptional() @IsString() note?: string | null;
  @IsOptional() @IsString() evidenceSummary?: string | null;
}

export class CreateFoiExemptionDto {
  @IsString() @IsNotEmpty() basisCode!: string;
  @IsString() @IsNotEmpty() title!: string;
  @IsOptional() @IsString() description?: string | null;
  @IsOptional() @IsString() classificationId?: string | null;
}

export class SaveFoiDecisionDto {
  @IsEnum(FoiDecisionOutcome) outcome!: FoiDecisionOutcome;
  @IsString() @IsNotEmpty() summary!: string;
  @IsString() @IsNotEmpty() justification!: string;
  @IsOptional() @IsString() responseTemplateId?: string | null;
  @IsOptional() @IsDateString() extendedDueAt?: string | null;
}

export class CreateFoiDisclosureDto {
  @IsOptional() @IsEnum(FoiDisclosureMethod) method?: FoiDisclosureMethod;
  @IsString() @IsNotEmpty() recipient!: string;
  @IsOptional() @IsUrl({ require_tld: false }) recordUrl?: string | null;
  @IsOptional() @IsString() summary?: string | null;
}

export class CreateFoiAppealDto {
  @IsString() @IsNotEmpty() reason!: string;
  @IsOptional() @IsEnum(FoiAppealStatus) status?: FoiAppealStatus;
  @IsOptional() @IsString() assignedOfficerPersonId?: string | null;
}
