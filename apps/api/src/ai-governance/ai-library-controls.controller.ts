import { RequireAnyPermissions } from '../auth/decorators';
import { Body, Controller, DefaultValuePipe, Get, Param, ParseIntPipe, ParseUUIDPipe, Post, Query, Res } from '@nestjs/common';
import { IsArray, ArrayMaxSize, ArrayMinSize, IsInt, IsIn, IsOptional, IsString, IsUUID, Length, Matches, Min } from 'class-validator';
import type { Response } from 'express';
import { AuthUser } from '../auth/auth.types';
import { CurrentUser, RequirePermissions } from '../auth/decorators';
import { AiLibrarySourceService } from './ai-library-source.service';
import { AiControlDomainsService } from './ai-control-domains.service';
import { AiLibraryControlLinksService } from './ai-library-control-links.service';
import { AiAssetRiskService } from './ai-asset-risk.service';
class EvidenceDto {@IsString() @Length(1,5000) justification!:string;@IsArray() @ArrayMinSize(1) @ArrayMaxSize(20) @IsUUID('4',{each:true}) evidenceIds!:string[];}
class SourceImportDto extends EvidenceDto {@IsUUID('4') requestKey!:string;@IsString() @Matches(/^[0-9a-f]{64}$/) expectedDigest!:string;@IsArray() @ArrayMinSize(1) @ArrayMaxSize(66) @IsString({each:true}) @Length(1,300,{each:true}) rowKeys!:string[];}
class ControlLinkDto extends EvidenceDto { @IsOptional() @IsUUID('4') categoryMappingVersionId?:string;@IsInt() @Min(0) expectedRound!:number;@IsArray() @ArrayMaxSize(10) @IsUUID('4',{each:true}) controlVersionIds!:string[];}
class ReviewControlLinkDto extends EvidenceDto {@IsIn(['approve','return']) outcome!:string;@IsString() @Matches(/^[0-9a-f]{64}$/) expectedDigest!:string;}
@Controller('ai/library-sources')
// Service methods additionally enforce purpose grants, scope, assignment and independent duties.
@RequireAnyPermissions('case.view.aiuc.own','case.view.aiuc.org','case.view.aiuc.all','case.view.airs.own','case.view.airs.org','case.view.airs.all','dashboard.view.exec.ai')
export class AiLibrarySourceController {
 constructor(private readonly service:AiLibrarySourceService){}
 @Post('snapshots/:id/proposals') propose(@CurrentUser() u:AuthUser,@Param('id',ParseUUIDPipe) id:string,@Body() dto:SourceImportDto){return this.service.propose(u.id,id,dto);}
 @Get('snapshots/:id/imports') list(@CurrentUser() u:AuthUser,@Param('id',ParseUUIDPipe) id:string,@Query('page',new DefaultValuePipe(1),ParseIntPipe) p:number,@Query('pageSize',new DefaultValuePipe(20),ParseIntPipe) n:number){return this.service.list(u.id,id,p,n);}
 @Get('imports/:id/reconciliation') reconcile(@CurrentUser() u:AuthUser,@Param('id',ParseUUIDPipe) id:string){return this.service.reconcile(u.id,id);}
 @Get('imports/:id/export') async export(@CurrentUser() u:AuthUser,@Param('id',ParseUUIDPipe) id:string,@Query('format',new DefaultValuePipe('json')) format:string,@Res() res:Response){const body=await this.service.export(u.id,id,format);res.setHeader('Content-Type',format==='csv'?'text/csv; charset=utf-8':'application/json; charset=utf-8');res.setHeader('Content-Disposition','attachment; filename="dgop-ai-library-reconciliation.'+(format==='csv'?'csv':'json')+'"');res.send(body);}
}
@Controller('ai')
// Service methods additionally enforce purpose grants, scope, assignment and independent duties.
@RequireAnyPermissions('case.view.aiuc.own','case.view.aiuc.org','case.view.aiuc.all','case.view.airs.own','case.view.airs.org','case.view.airs.all','dashboard.view.exec.ai')
export class AiControlLinksController {
 constructor(private readonly controls:AiControlDomainsService,private readonly links:AiLibraryControlLinksService){}
 @Get('control-domains') list(@CurrentUser() u:AuthUser){return this.controls.list(u.id);}
 @Get('risk-library/versions/:id/control-links') context(@CurrentUser() u:AuthUser,@Param('id',ParseUUIDPipe) id:string){return this.links.context(u.id,id);}
 @Post('risk-library/versions/:id/control-links') propose(@CurrentUser() u:AuthUser,@Param('id',ParseUUIDPipe) id:string,@Body() dto:ControlLinkDto){return this.links.propose(u.id,id,dto);}
 @Post('library-control-links/:id/review') review(@CurrentUser() u:AuthUser,@Param('id',ParseUUIDPipe) id:string,@Body() dto:ReviewControlLinkDto){return this.links.review(u.id,id,dto);}
}
@Controller('ai/assets')
// Service methods additionally enforce purpose grants, scope, assignment and independent duties.
@RequireAnyPermissions('case.view.aiuc.own','case.view.aiuc.org','case.view.aiuc.all','case.view.airs.own','case.view.airs.org','case.view.airs.all','dashboard.view.exec.ai')
@RequirePermissions('data_assets.view')
export class AiAssetRiskController {
 constructor(private readonly service:AiAssetRiskService){}
 @Get(':id/risk-summary') summary(@CurrentUser() u:AuthUser,@Param('id',ParseUUIDPipe) id:string){return this.service.summary(u.id,id);}
 @Get(':id/risks') register(@CurrentUser() u:AuthUser,@Param('id',ParseUUIDPipe) id:string,@Query('page',new DefaultValuePipe(1),ParseIntPipe) p:number,@Query('pageSize',new DefaultValuePipe(20),ParseIntPipe) n:number){return this.service.register(u.id,id,p,n);}
 @Get(':id/actions') actions(@CurrentUser() u:AuthUser,@Param('id',ParseUUIDPipe) id:string,@Query('page',new DefaultValuePipe(1),ParseIntPipe) p:number,@Query('pageSize',new DefaultValuePipe(20),ParseIntPipe) n:number,@Query('filter',new DefaultValuePipe('all')) filter:string){return this.service.actions(u.id,id,p,n,filter);}
 @Get(':id/risks/:riskId/history') history(@CurrentUser() u:AuthUser,@Param('id',ParseUUIDPipe) id:string,@Param('riskId',ParseUUIDPipe) riskId:string,@Query('page',new DefaultValuePipe(1),ParseIntPipe) p:number,@Query('pageSize',new DefaultValuePipe(20),ParseIntPipe) n:number){return this.service.history(u.id,id,riskId,p,n);}
 @Get(':id/reviews') reviews(@CurrentUser() u:AuthUser,@Param('id',ParseUUIDPipe) id:string,@Query('page',new DefaultValuePipe(1),ParseIntPipe) p:number,@Query('pageSize',new DefaultValuePipe(20),ParseIntPipe) n:number,@Query('filter',new DefaultValuePipe('active')) filter:string){return this.service.reviews(u.id,id,p,n,filter);}
}
