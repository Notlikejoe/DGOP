import { Body, Controller, Get, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import { CurrentUser, RequirePermissions, Roles } from '../auth/decorators';
import { AuthUser } from '../auth/auth.types';
import { AiReferencePublicationService } from './ai-reference-publication.service';
import { AiReferenceDecisionDto, ProposeAiReferenceDto } from './ai-reference.dto';

@Controller('ai/reference-data')
export class AiReferenceController {
  constructor(private readonly service:AiReferencePublicationService) {}
  @Get('proposals/:id')
  @Roles('AI_GOVERNANCE_OFFICER','AI_ETHICS_COMMITTEE','dmo_admin')
  review(@Param('id',ParseUUIDPipe) id:string,@CurrentUser() user:AuthUser) {
    return this.service.review(user.id,id);
  }
  @Post(':code/proposals')
  @RequirePermissions('refdata.propose.ai')
  propose(@Param('code') code:string,@Body() dto:ProposeAiReferenceDto,@CurrentUser() user:AuthUser) {
    return this.service.propose(user.id,code,dto);
  }
  @Post('proposals/:id/approve')
  @RequirePermissions('refdata.approve.ai')
  approve(@Param('id',ParseUUIDPipe) id:string,@Body() dto:AiReferenceDecisionDto,@CurrentUser() user:AuthUser) {
    return this.service.approve(user.id,id,dto.justification);
  }
  @Post('proposals/:id/publish')
  @RequirePermissions('refdata.publish')
  publish(@Param('id',ParseUUIDPipe) id:string,@Body() dto:AiReferenceDecisionDto,@CurrentUser() user:AuthUser) {
    return this.service.publish(user.id,id,dto.justification);
  }
}
