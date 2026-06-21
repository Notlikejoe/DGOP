import { IsBoolean, IsEmail, IsNotEmpty, IsOptional, IsString } from 'class-validator';

export class CreatePersonDto {
  @IsString() @IsNotEmpty() fullNameEn!: string;
  @IsString() @IsNotEmpty() fullNameAr!: string;
  @IsOptional() @IsEmail() email?: string | null;
  @IsOptional() @IsString() jobTitle?: string | null;
  @IsOptional() @IsString() organization?: string | null;
  @IsOptional() @IsString() userId?: string | null;
  @IsOptional() @IsBoolean() isActive?: boolean;
}

export class UpdatePersonDto {
  @IsOptional() @IsString() @IsNotEmpty() fullNameEn?: string;
  @IsOptional() @IsString() @IsNotEmpty() fullNameAr?: string;
  @IsOptional() @IsEmail() email?: string | null;
  @IsOptional() @IsString() jobTitle?: string | null;
  @IsOptional() @IsString() organization?: string | null;
  @IsOptional() @IsString() userId?: string | null;
  @IsOptional() @IsBoolean() isActive?: boolean;
}
