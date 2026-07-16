import { IsOptional, IsString } from 'class-validator';

export class CreateNdiAuditPackDto {
  @IsOptional()
  @IsString()
  domainId?: string;
}
