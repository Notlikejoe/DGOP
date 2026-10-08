import { RequireAnyPermissions } from '../auth/decorators';
import { Body, Controller, DefaultValuePipe, Get, Param, ParseIntPipe, ParseUUIDPipe, Post, Query, Res } from '@nestjs/common';
import { ArrayMaxSize, ArrayMinSize, IsArray, IsIn, IsString, IsUUID, Length, Matches } from 'class-validator';
import type { Response } from 'express';
import { CurrentUser } from '../auth/decorators';
import { AuthUser } from '../auth/auth.types';
import { AiMigrationPreviewService } from './ai-migration-preview.service';
class PreviewEvidenceDto {
 @IsString() @Length(1,5000) justification!:string;
 @IsArray() @ArrayMinSize(1) @ArrayMaxSize(20) @IsUUID('4',{each:true}) evidenceIds!:string[];
}
class CreatePreviewDto extends PreviewEvidenceDto {@IsUUID('4') requestKey!:string;}
class ReviewPreviewDto extends PreviewEvidenceDto {
 @IsString() @Matches(/^[0-9a-f]{64}$/) expectedDigest!:string;
 @IsIn(['accept','reject']) outcome!:string;
}
class DispositionPreviewDto extends PreviewEvidenceDto {
 @IsString() @Length(1,300) rowKey!:string;
 @IsString() @Matches(/^[0-9a-f]{64}$/) expectedDigest!:string;
 @IsIn(['defer','reject']) outcome!:string;
}
@Controller('ai/migration-previews')
// Service methods additionally enforce purpose grants, scope, assignment and independent duties.
@RequireAnyPermissions('case.view.aiuc.own','case.view.aiuc.org','case.view.aiuc.all','case.view.airs.own','case.view.airs.org','case.view.airs.all','dashboard.view.exec.ai')
export class AiMigrationPreviewController {
 constructor(private readonly previews:AiMigrationPreviewService){}
 @Get('context') context(@CurrentUser() u:AuthUser){return this.previews.context(u.id);}
 @Get() list(@CurrentUser() u:AuthUser,@Query('page',new DefaultValuePipe(1),ParseIntPipe) page:number,@Query('pageSize',new DefaultValuePipe(25),ParseIntPipe) size:number,@Query('search') search=''){return this.previews.list(u.id,page,size,search);}
 @Post() create(@CurrentUser() u:AuthUser,@Body() dto:CreatePreviewDto){return this.previews.create(u.id,dto);}
 @Get(':id') get(@CurrentUser() u:AuthUser,@Param('id',ParseUUIDPipe) id:string){return this.previews.get(u.id,id);}
 @Post(':id/dispositions') disposition(@CurrentUser() u:AuthUser,@Param('id',ParseUUIDPipe) id:string,@Body() dto:DispositionPreviewDto){return this.previews.disposition(u.id,id,dto);}
 @Post(':id/review') review(@CurrentUser() u:AuthUser,@Param('id',ParseUUIDPipe) id:string,@Body() dto:ReviewPreviewDto){return this.previews.review(u.id,id,dto);}
 @Get(':id/export') async export(@CurrentUser() u:AuthUser,@Param('id',ParseUUIDPipe) id:string,@Query('format',new DefaultValuePipe('json')) format:string,@Res() res:Response){
  const content=await this.previews.export(u.id,id,format);res.setHeader('Content-Type',format==='csv'?'text/csv; charset=utf-8':'application/json; charset=utf-8');res.setHeader('Content-Disposition','attachment; filename="dgop-ai-source-preview.'+(format==='csv'?'csv':'json')+'"');res.send(content);
 }
}
