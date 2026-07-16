import {
  BreachSeverity,
  BreachStatus,
  ConsentStatus,
  DpiaRiskLevel,
  DsrRequestStatus,
  DsrRequestType,
  PrivacyGatePhase,
  PrivacyGateStatus,
  PrivacyLegalBasisCategory,
  PrivacyWorkStatus,
  RetentionTrigger,
} from '@prisma/client';
import {
  IsBoolean,
  IsDateString,
  IsEmail,
  IsEnum,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  Min,
  Max,
} from 'class-validator';

export class CreatePrivacyLegalBasisDto {
  @IsString() @IsNotEmpty() code!: string;
  @IsString() @IsNotEmpty() nameEn!: string;
  @IsString() @IsNotEmpty() nameAr!: string;
  @IsEnum(PrivacyLegalBasisCategory) category!: PrivacyLegalBasisCategory;
  @IsOptional() @IsString() description?: string | null;
  @IsOptional() @IsString() authority?: string | null;
}

export class CreateRopaRecordDto {
  @IsString() @IsNotEmpty() processName!: string;
  @IsString() @IsNotEmpty() purpose!: string;
  @IsOptional() @IsString() assetId?: string | null;
  @IsOptional() @IsString() domainId?: string | null;
  @IsOptional() @IsString() legalBasisId?: string | null;
  @IsOptional() @IsString() ownerPersonId?: string | null;
  @IsOptional() @IsString() dataSubjects?: string | null;
  @IsOptional() @IsString() recipients?: string | null;
  @IsOptional() @IsString() retentionSummary?: string | null;
  @IsOptional() @IsDateString() reviewDueAt?: string | null;
  @IsOptional() @IsEnum(PrivacyWorkStatus) status?: PrivacyWorkStatus;
}

export class CreateDpiaDto {
  @IsString() @IsNotEmpty() title!: string;
  @IsOptional() @IsString() description?: string | null;
  @IsOptional() @IsString() assetId?: string | null;
  @IsOptional() @IsString() domainId?: string | null;
  @IsOptional() @IsString() legalBasisId?: string | null;
  @IsOptional() @IsString() classificationId?: string | null;
  @IsOptional() @IsBoolean() crossBorderTransfer?: boolean;
  @IsOptional() @IsString() reviewerPersonId?: string | null;
  @IsOptional() @IsInt() @Min(0) @Max(100) existingControls?: number;
  @IsOptional() @IsDateString() dueAt?: string | null;
}

export class UpdateDpiaDto {
  @IsOptional() @IsString() @IsNotEmpty() title?: string;
  @IsOptional() @IsString() description?: string | null;
  @IsOptional() @IsEnum(PrivacyWorkStatus) status?: PrivacyWorkStatus;
  @IsOptional() @IsEnum(DpiaRiskLevel) riskLevel?: DpiaRiskLevel;
  @IsOptional() @IsInt() @Min(0) @Max(100) residualRiskScore?: number;
  @IsOptional() @IsString() decisionSummary?: string | null;
  @IsOptional() @IsDateString() completedAt?: string | null;
}

export class SavePrivacyGateDto {
  @IsEnum(PrivacyGatePhase) phase!: PrivacyGatePhase;
  @IsOptional() @IsEnum(PrivacyGateStatus) status?: PrivacyGateStatus;
  @IsOptional() @IsString() reviewerPersonId?: string | null;
  @IsOptional() @IsString() note?: string | null;
  @IsOptional() @IsDateString() dueAt?: string | null;
}

export class CreateDsrRequestDto {
  @IsString() @IsNotEmpty() requesterName!: string;
  @IsOptional() @IsEmail() requesterEmail?: string | null;
  @IsEnum(DsrRequestType) requestType!: DsrRequestType;
  @IsString() @IsNotEmpty() description!: string;
  @IsOptional() @IsBoolean() identityValidated?: boolean;
  @IsOptional() @IsString() assetId?: string | null;
  @IsOptional() @IsString() domainId?: string | null;
  @IsOptional() @IsString() assignedPersonId?: string | null;
  @IsOptional() @IsDateString() dueAt?: string | null;
}

export class UpdateDsrRequestDto {
  @IsOptional() @IsEnum(DsrRequestStatus) status?: DsrRequestStatus;
  @IsOptional() @IsBoolean() identityValidated?: boolean;
  @IsOptional() @IsString() assignedPersonId?: string | null;
  @IsOptional() @IsString() decisionSummary?: string | null;
  @IsOptional() @IsDateString() fulfilledAt?: string | null;
}

export class CreateBreachDto {
  @IsString() @IsNotEmpty() title!: string;
  @IsOptional() @IsString() description?: string | null;
  @IsOptional() @IsString() assetId?: string | null;
  @IsOptional() @IsString() domainId?: string | null;
  @IsOptional() @IsEnum(BreachSeverity) severity?: BreachSeverity;
  @IsOptional() @IsDateString() detectedAt?: string | null;
  @IsOptional() @IsString() assignedPersonId?: string | null;
}

export class UpdateBreachDto {
  @IsOptional() @IsEnum(BreachStatus) status?: BreachStatus;
  @IsOptional() @IsEnum(BreachSeverity) severity?: BreachSeverity;
  @IsOptional() @IsDateString() containedAt?: string | null;
  @IsOptional() @IsDateString() notifiedAt?: string | null;
  @IsOptional() @IsBoolean() regulatorNotified?: boolean;
  @IsOptional() @IsBoolean() subjectNotified?: boolean;
}

export class CreateConsentRecordDto {
  @IsOptional() @IsString() assetId?: string | null;
  @IsString() @IsNotEmpty() subjectRef!: string;
  @IsString() @IsNotEmpty() purpose!: string;
  @IsOptional() @IsString() legalBasisId?: string | null;
  @IsOptional() @IsEnum(ConsentStatus) status?: ConsentStatus;
  @IsOptional() @IsDateString() expiresAt?: string | null;
  @IsOptional() @IsString() source?: string;
}

export class CreateRetentionRuleDto {
  @IsString() @IsNotEmpty() nameEn!: string;
  @IsString() @IsNotEmpty() nameAr!: string;
  @IsOptional() @IsString() assetId?: string | null;
  @IsOptional() @IsString() domainId?: string | null;
  @IsOptional() @IsEnum(RetentionTrigger) trigger?: RetentionTrigger;
  @IsInt() @Min(1) durationDays!: number;
  @IsOptional() @IsString() action?: string;
  @IsOptional() @IsString() ownerPersonId?: string | null;
  @IsOptional() @IsDateString() nextReviewAt?: string | null;
}
