import { BadRequestException } from '@nestjs/common';
import { CaseStatus } from '@prisma/client';
import { Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';
import { PageParams } from '../common/pagination';

export class AiRegisterQueryDto {
  @IsOptional() @Type(()=>Number) @IsInt() @Min(1) @Max(1000000) page=1;
  @IsOptional() @Type(()=>Number) @IsInt() @Min(1) @Max(200) pageSize=25;
  @IsOptional() @IsString() @MaxLength(200) search='';
  @IsOptional() @IsIn(['all',...Object.values(CaseStatus)]) status='all';
}
export function aiRegisterParams(query:AiRegisterQueryDto):PageParams {
  const {page=1,pageSize=25,search='',status='all'}=query;
  if(!Number.isInteger(page)||page<1||page>1000000||!Number.isInteger(pageSize)||pageSize<1||pageSize>200||typeof search!=='string'||search.length>200||!['all',...Object.values(CaseStatus)].includes(status))throw new BadRequestException('Use valid AI register pagination, search and workflow status');
  return {page,pageSize,skip:(page-1)*pageSize,take:pageSize};
}
