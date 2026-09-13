import { Body, Controller, DefaultValuePipe, Get, Param, ParseIntPipe, ParseUUIDPipe, Post, Query, Res } from '@nestjs/common';
import { Type } from 'class-transformer';
import { ArrayMaxSize, ArrayMinSize, IsArray, IsIn, IsInt, IsOptional, IsString, IsUUID, Length, Matches, Min, ValidateNested } from 'class-validator';
import { Response } from 'express';
import { AuthUser } from '../auth/auth.types';
import { CurrentUser } from '../auth/decorators';
import { AiCategoryControlsService } from './ai-category-controls.service';
import { AiMigrationPilotService } from './ai-migration-pilot.service';
import { AiSourceNativeService } from './ai-source-native.service';
class ReasonDto {@IsString() @Length(1,5000) justification!:string;@IsArray() @ArrayMinSize(1) @ArrayMaxSize(20) @IsUUID('4',{each:true}) evidenceIds!:string[];}
class MappingDto extends ReasonDto {@IsInt() @Min(0) expectedRound!:number;@IsArray() @ArrayMaxSize(10) @IsUUID('4',{each:true}) controlVersionIds!:string[];}
class ReviewDto extends ReasonDto {@IsIn(['approve','return']) outcome!:string;@IsString() @Matches(/^[0-9a-f]{64}$/) expectedDigest!:string;}
class BindingDto {@IsString() @Length(1,300) rowKey!:string;@IsUUID('4') targetId!:string;}
class CaptureDto extends ReasonDto {@IsInt() @Min(0) expectedRound!:number;@IsString() @Matches(/^[0-9a-f]{64}$/) expectedDigest!:string;@IsUUID('4') requestKey!:string;@IsArray() @ArrayMaxSize(250) @ValidateNested({each:true}) @Type(()=>BindingDto) bindings!:BindingDto[];}
class DraftDto extends ReasonDto {@IsString() @Length(1,300) rowKey!:string;@IsString() @Matches(/^[0-9a-f]{64}$/) expectedDigest!:string;@IsUUID('4') requestKey!:string;@IsOptional() @IsUUID('4') useCaseId?:string;}
@Controller('ai')
export class AiCycleAController {
 constructor(private readonly categories:AiCategoryControlsService,private readonly pilot:AiMigrationPilotService,private readonly native:AiSourceNativeService){}
 @Get('category-control-mappings') categoriesContext(@CurrentUser() u:AuthUser){return this.categories.context(u.id);}
 @Post('category-control-mappings/categories/:code') propose(@CurrentUser() u:AuthUser,@Param('code') code:string,@Body() dto:MappingDto){return this.categories.propose(u.id,code,dto);}
 @Post('category-control-mappings/:id/review') review(@CurrentUser() u:AuthUser,@Param('id',ParseUUIDPipe) id:string,@Body() dto:ReviewDto){return this.categories.review(u.id,id,dto);}
 @Post('migration-pilot/snapshots/:id/native-drafts') draft(@CurrentUser() u:AuthUser,@Param('id',ParseUUIDPipe) id:string,@Body() dto:DraftDto){return this.native.create(u.id,id,dto);}
 @Get('migration-pilot/snapshots/:id/targets') targets(@CurrentUser() u:AuthUser,@Param('id',ParseUUIDPipe) id:string,@Query('kind') kind:string,@Query('search',new DefaultValuePipe('')) search:string){return this.pilot.targets(u.id,id,kind,search);}
 @Get('migration-pilot/snapshots/:id/captures') archive(@CurrentUser() u:AuthUser,@Param('id',ParseUUIDPipe) id:string,@Query('page',new DefaultValuePipe(1),ParseIntPipe) page:number){return this.pilot.context(u.id,id,page);}
 @Post('migration-pilot/snapshots/:id/captures') capture(@CurrentUser() u:AuthUser,@Param('id',ParseUUIDPipe) id:string,@Body() dto:CaptureDto){return this.pilot.capture(u.id,id,dto);}
 @Post('migration-pilot/captures/:id/review') pilotReview(@CurrentUser() u:AuthUser,@Param('id',ParseUUIDPipe) id:string,@Body() dto:ReviewDto){return this.pilot.review(u.id,id,dto);}
 @Get('migration-pilot/captures/:id/export') async export(@CurrentUser() u:AuthUser,@Param('id',ParseUUIDPipe) id:string,@Query('format',new DefaultValuePipe('json')) format:string,@Res() res:Response){const body=await this.pilot.export(u.id,id,format);res.setHeader('Content-Type',format==='csv'?'text/csv; charset=utf-8':'application/json; charset=utf-8');res.setHeader('Content-Disposition','attachment; filename="dgop-ai-native-pilot.'+(format==='csv'?'csv':'json')+'"');res.send(body);}
}
