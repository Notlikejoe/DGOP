import { Type } from 'class-transformer';
import { IsInt, IsObject, IsString, IsUUID, MaxLength, Min } from 'class-validator';

export class AiRiskVersionDto {
  @Type(() => Number) @IsInt() @Min(1) expectedVersion!: number;
}
export class AssignAiRiskOwnerDto extends AiRiskVersionDto {
  @IsUUID('4') ownerUserId!: string;
  @IsString() @MaxLength(2000) justification!: string;
}
export class SaveAiRiskIntakeDto extends AiRiskVersionDto {
  @IsObject() input!: Record<string, unknown>;
}
