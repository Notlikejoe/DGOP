import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import { ArrayMaxSize, ArrayMinSize, IsArray, IsNotEmpty, IsString, IsUUID, MaxLength } from 'class-validator';
import { CurrentUser, RequireAnyPermissions } from '../auth/decorators';
import { AuthUser } from '../auth/auth.types';
import { AiEvidenceService } from './ai-evidence.service';
import { AiReviewQueryDto } from './ai-review-query.dto';
export class LinkAiEvidenceDto {
  @IsArray() @ArrayMinSize(1) @ArrayMaxSize(20) @IsUUID('4',{each:true}) evidenceIds!:string[];
  @IsString() @IsNotEmpty() @MaxLength(5000) justification!:string;
}
@Controller('ai/evidence')
@RequireAnyPermissions('case.view.aiuc.own','case.view.aiuc.org','case.view.aiuc.all','case.view.airs.own','case.view.airs.org','case.view.airs.all')
export class AiEvidenceController {
  constructor(private readonly service:AiEvidenceService) {}
  @Get(':targetType/:targetId') read(@CurrentUser() u:AuthUser,@Param('targetType') type:string,@Param('targetId',ParseUUIDPipe) id:string,@Query() query:AiReviewQueryDto){return this.service.read(u.id,type,id,query);}
  @Post(':targetType/:targetId/links') link(@CurrentUser() u:AuthUser,@Param('targetType') type:string,@Param('targetId',ParseUUIDPipe) id:string,@Body() dto:LinkAiEvidenceDto){return this.service.link(u.id,type,id,dto.evidenceIds,dto.justification);}
}
