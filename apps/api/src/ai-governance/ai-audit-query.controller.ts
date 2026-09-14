import { Controller, Get, Query, Res } from '@nestjs/common';
import { IsIn, IsInt, IsISO8601, IsOptional, IsUUID, Max, Min } from 'class-validator';
import { Type } from 'class-transformer';
import { Response } from 'express';
import { CurrentUser } from '../auth/decorators';
import { AuthUser } from '../auth/auth.types';
import { AiAuditQueryService } from './ai-audit-query.service';
export class AuditQueryDto {
 @IsOptional() @IsIn(['airs','aiuc','all']) kind?:'airs'|'aiuc'|'all';
 @IsOptional() @IsIn(['redacted','full']) detail?:'redacted'|'full';
 @IsOptional() @IsUUID('4') caseId?:string;
 @IsOptional() @IsUUID('4') assetId?:string;
 @IsOptional() @IsUUID('4') actorId?:string;
 @IsOptional() @IsISO8601({strict:true}) from?:string;
 @IsOptional() @IsISO8601({strict:true}) to?:string;
 @IsOptional() @Type(()=>Number) @IsInt() @Min(1) page?:number;
 @IsOptional() @Type(()=>Number) @IsInt() @Min(1) @Max(100) pageSize?:number;
}
@Controller('ai/audit')
export class AiAuditQueryController {
 constructor(private readonly audit:AiAuditQueryService){}
 @Get() query(@CurrentUser() user:AuthUser,@Query() query:AuditQueryDto){return this.audit.query(user.id,query);}
 @Get('export') async csv(@CurrentUser() user:AuthUser,@Query() query:AuditQueryDto,@Res() response:Response){
  const result=await this.audit.csv(user.id,query);response.setHeader('Content-Type','text/csv; charset=utf-8');response.setHeader('Content-Disposition','attachment; filename="DGOP-AI-audit-page.csv"');response.send(result);
 }
}
