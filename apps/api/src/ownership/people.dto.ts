import { Transform } from 'class-transformer';
import { IsBoolean, IsEmail, IsNotEmpty, IsOptional, IsString, IsUUID, MaxLength } from 'class-validator';

const Trim = () => Transform(({ value }) => (typeof value === 'string' ? value.trim() : value));
const TrimOptional = () =>
  Transform(({ value }) => {
    if (typeof value !== 'string') return value;
    const trimmed = value.trim();
    return trimmed.length ? trimmed : null;
  });

const PERSON_NAME_MAX = 180;
const PERSON_SHORT_TEXT_MAX = 160;

export class CreatePersonDto {
  @IsString() @IsNotEmpty() @MaxLength(PERSON_NAME_MAX) @Trim() fullNameEn!: string;
  @IsString() @IsNotEmpty() @MaxLength(PERSON_NAME_MAX) @Trim() fullNameAr!: string;
  @IsOptional() @IsEmail() @MaxLength(PERSON_SHORT_TEXT_MAX) @TrimOptional() email?: string | null;
  @IsOptional() @IsString() @MaxLength(PERSON_SHORT_TEXT_MAX) @TrimOptional() jobTitle?: string | null;
  @IsOptional() @IsString() @MaxLength(PERSON_SHORT_TEXT_MAX) @TrimOptional() organization?: string | null;
  @IsOptional() @IsUUID() @TrimOptional() userId?: string | null;
  @IsOptional() @IsBoolean() isActive?: boolean;
}

export class UpdatePersonDto {
  @IsOptional() @IsString() @IsNotEmpty() @MaxLength(PERSON_NAME_MAX) @Trim() fullNameEn?: string;
  @IsOptional() @IsString() @IsNotEmpty() @MaxLength(PERSON_NAME_MAX) @Trim() fullNameAr?: string;
  @IsOptional() @IsEmail() @MaxLength(PERSON_SHORT_TEXT_MAX) @TrimOptional() email?: string | null;
  @IsOptional() @IsString() @MaxLength(PERSON_SHORT_TEXT_MAX) @TrimOptional() jobTitle?: string | null;
  @IsOptional() @IsString() @MaxLength(PERSON_SHORT_TEXT_MAX) @TrimOptional() organization?: string | null;
  @IsOptional() @IsUUID() @TrimOptional() userId?: string | null;
  @IsOptional() @IsBoolean() isActive?: boolean;
}
