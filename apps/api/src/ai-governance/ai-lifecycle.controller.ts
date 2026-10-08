import { Body,Controller,Get,Param,ParseUUIDPipe,Post,Query } from '@nestjs/common';
import { CurrentUser,RequireAnyPermissions,RequirePermissions } from '../auth/decorators';
import { AuthUser } from '../auth/auth.types';
import { AiLifecycleService } from './ai-lifecycle.service';
import { AiReviewQueryDto } from './ai-review-query.dto';
import { ProposeAiLifecycleDto,AssessAiLifecycleDto,DecideAiLifecycleDto } from './ai-lifecycle.dto';
@Controller('ai/lifecycle')
@RequireAnyPermissions('case.view.aiuc.own','case.view.aiuc.org','case.view.aiuc.all')
export class AiLifecycleController {
 constructor(private readonly service:AiLifecycleService){}
 @Get('use-cases/:id') context(@CurrentUser() user:AuthUser,@Param('id',ParseUUIDPipe) id:string,@Query() query:AiReviewQueryDto){return this.service.context(user.id,id,query);}
 @Get('use-cases/:id/nominees') nominees(@CurrentUser() user:AuthUser,@Param('id',ParseUUIDPipe) id:string,@Query() query:AiReviewQueryDto){return this.service.nominees(user.id,id,query);}
 @Post('use-cases/:id/propose') @RequirePermissions('case.create.aiuc') propose(@CurrentUser() user:AuthUser,@Param('id',ParseUUIDPipe) id:string,@Body() dto:ProposeAiLifecycleDto){return this.service.propose(user.id,id,dto);}
 @Post(':id/tasks/:taskId/assess') @RequireAnyPermissions('aiuc.classify.assess','airs.risk.assess') assess(@CurrentUser() user:AuthUser,@Param('id',ParseUUIDPipe) id:string,@Param('taskId',ParseUUIDPipe) taskId:string,@Body() dto:AssessAiLifecycleDto){return this.service.assess(user.id,id,taskId,dto);}
 @Post(':id/tasks/:taskId/decide') @RequireAnyPermissions('case.approve.aiuc','aiuc.asset.approve','airs.risk.assess','case.view.aiuc.org') decide(@CurrentUser() user:AuthUser,@Param('id',ParseUUIDPipe) id:string,@Param('taskId',ParseUUIDPipe) taskId:string,@Body() dto:DecideAiLifecycleDto){return this.service.decide(user.id,id,taskId,dto);}
 @Post(':id/withdraw') @RequirePermissions('case.create.aiuc') withdraw(@CurrentUser() user:AuthUser,@Param('id',ParseUUIDPipe) id:string,@Body() dto:AssessAiLifecycleDto){return this.service.withdraw(user.id,id,dto.expectedVersion,dto.justification);}
}
