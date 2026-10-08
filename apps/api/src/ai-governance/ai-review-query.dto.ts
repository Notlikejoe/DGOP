import { BadRequestException } from '@nestjs/common';
import { Type } from 'class-transformer';
import { IsInt, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';
import { PageParams } from '../common/pagination';

export class AiReviewQueryDto {
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(1000000) page = 1;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(200) pageSize = 25;
  @IsOptional() @IsString() @MaxLength(200) search = '';
}

export function aiReviewParams(query: AiReviewQueryDto): PageParams {
  const { page = 1, pageSize = 25, search = '' } = query;
  if (!Number.isInteger(page) || page < 1 || page > 1000000 || !Number.isInteger(pageSize)
      || pageSize < 1 || pageSize > 200 || typeof search !== 'string' || search.length > 200) {
    throw new BadRequestException('Use valid AI review pagination and a search of at most 200 characters');
  }
  return { page, pageSize, skip: (page - 1) * pageSize, take: pageSize };
}
