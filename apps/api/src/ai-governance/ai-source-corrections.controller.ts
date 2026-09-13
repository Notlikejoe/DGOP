import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Query, DefaultValuePipe, Res } from '@nestjs/common';
import { ArrayMaxSize, ArrayMinSize, IsArray, IsIn, IsInt, IsString, IsUUID, Length, Matches, Min, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';
import type { Response } from 'express';
import { CurrentUser } from '../auth/decorators';
import { AuthUser } from '../auth/auth.types';
import { AiSourceCorrectionsService } from './ai-source-corrections.service';
class SourceEvidenceDto {
 @IsString() @Length(1,5000) justification!:string;
 @IsArray() @ArrayMinSize(1) @ArrayMaxSize(20) @IsUUID('4',{each:true}) evidenceIds!:string[];
}
class SourceBindingDto {
 @IsString() @Length(1,300) rowKey!:string;
 @IsString() @Length(1,100) field!:string;
 @IsString() @Length(1,5000) value!:string;
}
class ProposeSourceDto extends SourceEvidenceDto {
 @IsInt() @Min(0) expectedRound!:number;
 @IsUUID('4') requestKey!:string;
 @IsArray() @ArrayMinSize(1) @ArrayMaxSize(400) @ValidateNested({each:true}) @Type(()=>SourceBindingDto) entries!:SourceBindingDto[];
}
class SourceDigestDto extends SourceEvidenceDto {@IsString() @Matches(/^[0-9a-f]{64}$/) expectedDigest!:string;}
class ReviewSourceDto extends SourceDigestDto {@IsIn(['approve','return']) outcome!:string;}
class ProposeControlDto extends SourceEvidenceDto {
 @IsString() @Length(1,300) sourceRowKey!:string;
 @IsString() @Matches(/^[A-Z][A-Z0-9_]{2,39}$/) controlCode!:string;
 @IsInt() @Min(0) expectedRound!:number;
 @IsString() @Length(1,200) titleEn!:string;
 @IsString() @Length(1,200) titleAr!:string;
 @IsArray() @ArrayMinSize(1) @ArrayMaxSize(8) @IsString({each:true}) dimensionCodes!:string[];
}
@Controller('ai/source-corrections')
export class AiSourceCorrectionsController {
 constructor(private readonly corrections:AiSourceCorrectionsService){}
 @Get('previews/:id/context') context(@CurrentUser() u:AuthUser,@Param('id',ParseUUIDPipe) id:string){return this.corrections.context(u.id,id);}
 @Post('previews/:id/versions') propose(@CurrentUser() u:AuthUser,@Param('id',ParseUUIDPipe) id:string,@Body() dto:ProposeSourceDto){return this.corrections.propose(u.id,id,dto);}
 @Post('versions/:id/review') review(@CurrentUser() u:AuthUser,@Param('id',ParseUUIDPipe) id:string,@Body() dto:ReviewSourceDto){return this.corrections.review(u.id,id,dto);}
 @Post('versions/:id/capture') capture(@CurrentUser() u:AuthUser,@Param('id',ParseUUIDPipe) id:string,@Body() dto:SourceDigestDto){return this.corrections.capture(u.id,id,dto);}
 @Post('previews/:id/controls') control(@CurrentUser() u:AuthUser,@Param('id',ParseUUIDPipe) id:string,@Body() dto:ProposeControlDto){return this.corrections.proposeControl(u.id,id,dto);}
 @Post('controls/:id/publish') publish(@CurrentUser() u:AuthUser,@Param('id',ParseUUIDPipe) id:string,@Body() dto:SourceDigestDto){return this.corrections.publishControl(u.id,id,dto);}
 @Get('snapshots/:id') snapshot(@CurrentUser() u:AuthUser,@Param('id',ParseUUIDPipe) id:string){return this.corrections.snapshot(u.id,id);}
 @Get('snapshots/:id/export') async export(@CurrentUser() u:AuthUser,@Param('id',ParseUUIDPipe) id:string,@Query('format',new DefaultValuePipe('json')) format:string,@Res() res:Response){const body=await this.corrections.export(u.id,id,format);res.setHeader('Content-Type',format==='csv'?'text/csv; charset=utf-8':'application/json; charset=utf-8');res.setHeader('Content-Disposition','attachment; filename="dgop-ai-source-corrections.'+(format==='csv'?'csv':'json')+'"');res.send(body);}
}
