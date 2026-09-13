import { Body, Controller, DefaultValuePipe, Get, Param, ParseIntPipe, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import { CurrentUser } from '../auth/decorators';
import { AuthUser } from '../auth/auth.types';
import { AiRiskLibraryService } from './ai-risk-library.service';
import { ProposeRiskLibraryDto, PublishRiskLibraryDto } from './ai-risk-library.dto';
@Controller('ai/risk-library')
export class AiRiskLibraryController {
 constructor(private readonly library:AiRiskLibraryService){}
 @Get('lookups') lookups(@CurrentUser() u:AuthUser){return this.library.lookups(u.id);}
 @Get('proposals') proposals(@CurrentUser() u:AuthUser){return this.library.proposals(u.id);}
 @Get() list(@CurrentUser() u:AuthUser,@Query('page',new DefaultValuePipe(1),ParseIntPipe) page:number,@Query('pageSize',new DefaultValuePipe(20),ParseIntPipe) size:number,@Query('search',new DefaultValuePipe('')) search:string){return this.library.list(u.id,page,size,search);}
 @Post('proposals') propose(@CurrentUser() u:AuthUser,@Body() dto:ProposeRiskLibraryDto){return this.library.propose(u.id,dto);}
 @Post('versions/:id/publish') publish(@CurrentUser() u:AuthUser,@Param('id',ParseUUIDPipe) id:string,@Body() dto:PublishRiskLibraryDto){return this.library.publish(u.id,id,dto.justification,dto.evidenceIds);}
}
