import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { AssignmentsService } from './assignments.service';
import {
  ApplyRecommendationDto,
  CreateAssignmentDto,
  RecommendationFeedbackDto,
  CreateRuleDto,
  UpdateAssignmentDto,
  UpdateRuleDto,
} from './assignments.dto';
import { CurrentUser, RequirePermissions } from '../auth/decorators';
import { AuthUser } from '../auth/auth.types';

@Controller()
export class AssignmentsController {
  constructor(private readonly service: AssignmentsService) {}

  // ----- assignment rules (declare before /assignments/:id to avoid route clash) -----
  @Get('assignment-rules')
  @RequirePermissions('assignment_rules.view')
  listRules(
    @CurrentUser() user: AuthUser,
    @Query('scopeType') scopeType?: string,
    @Query('roleTypeId') roleTypeId?: string,
  ) {
    return this.service.listRules({ scopeType, roleTypeId }, user.roles);
  }

  @Post('assignment-rules')
  @RequirePermissions('assignment_rules.create')
  createRule(@Body() dto: CreateRuleDto, @CurrentUser() user: AuthUser) {
    return this.service.createRule(dto, user.email, user.roles);
  }

  @Patch('assignment-rules/:id')
  @RequirePermissions('assignment_rules.edit')
  updateRule(@Param('id') id: string, @Body() dto: UpdateRuleDto, @CurrentUser() user: AuthUser) {
    return this.service.updateRule(id, dto, user.email, user.roles);
  }

  @Delete('assignment-rules/:id')
  @RequirePermissions('assignment_rules.delete')
  removeRule(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.service.removeRule(id, user.email, user.roles);
  }

  // ----- recommendations / conflicts / exceptions -----
  @Get('assets/:id/recommendations')
  @RequirePermissions('assignments.view')
  recommend(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.service.recommend(user.roles, id);
  }

  @Post('assignments/apply-recommendation')
  @RequirePermissions('assignments.create')
  apply(@Body() dto: ApplyRecommendationDto, @CurrentUser() user: AuthUser) {
    return this.service.applyRecommendation(user.roles, dto, user.email);
  }

  @Post('assets/:id/recommendations/:roleTypeId/feedback')
  @RequirePermissions('assignments.create')
  recommendationFeedback(
    @Param('id') id: string,
    @Param('roleTypeId') roleTypeId: string,
    @Body() dto: RecommendationFeedbackDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.service.recordRecommendationFeedback(user.roles, id, roleTypeId, dto, user.email);
  }

  @Get('assignments/conflicts')
  @RequirePermissions('assignments.view')
  conflicts(@CurrentUser() user: AuthUser) {
    return this.service.conflicts(user.roles);
  }

  @Get('assignments/exceptions')
  @RequirePermissions('assignments.view')
  exceptions(@CurrentUser() user: AuthUser) {
    return this.service.exceptions(user.roles);
  }

  // ----- assignments CRUD -----
  @Get('assignments')
  @RequirePermissions('assignments.view')
  list(
    @CurrentUser() user: AuthUser,
    @Query('targetType') targetType?: string,
    @Query('targetId') targetId?: string,
    @Query('roleTypeId') roleTypeId?: string,
    @Query('personId') personId?: string,
    @Query('status') status?: string,
    @Query('approvalStatus') approvalStatus?: string,
  ) {
    return this.service.listAssignments(user.roles, {
      targetType,
      targetId,
      roleTypeId,
      personId,
      status,
      approvalStatus,
    });
  }

  @Get('assignments/:id')
  @RequirePermissions('assignments.view')
  get(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.service.getAssignment(id, user.roles);
  }

  @Post('assignments')
  @RequirePermissions('assignments.create')
  create(@Body() dto: CreateAssignmentDto, @CurrentUser() user: AuthUser) {
    return this.service.createAssignment(dto, user.email, undefined, undefined, user.roles);
  }

  @Patch('assignments/:id')
  @RequirePermissions('assignments.edit')
  update(@Param('id') id: string, @Body() dto: UpdateAssignmentDto, @CurrentUser() user: AuthUser) {
    return this.service.updateAssignment(id, dto, user.email, user.roles);
  }

  @Delete('assignments/:id')
  @RequirePermissions('assignments.delete')
  remove(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.service.removeAssignment(id, user.email, user.roles);
  }
}
