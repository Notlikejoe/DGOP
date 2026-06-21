import {
  IsArray,
  IsBoolean,
  IsEmail,
  IsNotEmpty,
  IsOptional,
  IsString,
  MinLength,
} from 'class-validator';

export class CreateUserDto {
  @IsEmail() email!: string;
  @IsString() @IsNotEmpty() displayName!: string;
  @IsString() @MinLength(8) password!: string;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  roleCodes?: string[];
}

export class UpdateUserDto {
  @IsOptional() @IsString() @IsNotEmpty() displayName?: string;
  @IsOptional() @IsBoolean() isActive?: boolean;
}

export class SetUserRolesDto {
  @IsArray()
  @IsString({ each: true })
  roleCodes!: string[];
}

export class ResetPasswordDto {
  @IsString() @MinLength(8) password!: string;
}
