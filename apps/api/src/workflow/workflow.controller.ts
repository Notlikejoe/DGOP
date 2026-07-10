import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { WorkflowService } from './workflow.service';
import {
  AddTaskDto,
  CreateCaseDto,
  DecisionDto,
  SubmitAssignmentDto,
  UpdateCaseDto,
  UpdateTaskDto,
} from './workflow.dto';
import { CurrentUser, RequirePermissions } from '../auth/decorators';
import { AuthUser } from '../auth/auth.types';

@Controller('workflow')
export class WorkflowController {
  constructor(private readonly service: WorkflowService) {}

  // ----- cases -----
  @Get('cases')
  @RequirePermissions('workflow_cases.view')
  listCases(
    @CurrentUser() user: AuthUser,
    @Query('status') status?: string,
    @Query('type') type?: string,
  ) {
    return this.service.listCases(user.roles, { status, type });
  }

  @Post('cases')
  @RequirePermissions('workflow_cases.create')
  createCase(@Body() dto: CreateCaseDto, @CurrentUser() user: AuthUser) {
    return this.service.createCase(dto, user.roles, user.email);
  }

  @Get('cases/:id')
  @RequirePermissions('workflow_cases.view')
  getCase(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.service.getCase(user.roles, id);
  }

  @Patch('cases/:id')
  @RequirePermissions('workflow_cases.edit')
  updateCase(@Param('id') id: string, @Body() dto: UpdateCaseDto, @CurrentUser() user: AuthUser) {
    return this.service.updateCase(id, dto, user.roles, user.email);
  }

  @Post('cases/:id/submit')
  @RequirePermissions('workflow_cases.edit')
  submitCase(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.service.submitCase(id, user.roles, user.email);
  }

  @Post('cases/:id/tasks')
  @RequirePermissions('workflow_tasks.create')
  addTask(@Param('id') id: string, @Body() dto: AddTaskDto, @CurrentUser() user: AuthUser) {
    return this.service.addTask(id, dto, user.roles, user.email);
  }

  // ----- assignment approval entry point -----
  @Post('assignments/submit-for-approval')
  @RequirePermissions('assignments.edit')
  submitAssignment(@Body() dto: SubmitAssignmentDto, @CurrentUser() user: AuthUser) {
    return this.service.submitAssignmentForApproval(dto, user.roles, user.email);
  }

  // ----- tasks (declare specific routes before :id) -----
  @Get('tasks/mine')
  @RequirePermissions('workflow_tasks.view')
  myTasks(@CurrentUser() user: AuthUser, @Query('status') status?: string) {
    return this.service.listMyTasks(user.id, { status });
  }

  @Get('tasks/:id')
  @RequirePermissions('workflow_tasks.view')
  getTask(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.service.getTask(id, user.roles);
  }

  @Patch('tasks/:id')
  @RequirePermissions('workflow_tasks.edit')
  updateTask(@Param('id') id: string, @Body() dto: UpdateTaskDto, @CurrentUser() user: AuthUser) {
    return this.service.updateTask(id, dto, user.roles, user.email);
  }

  @Post('tasks/:id/decision')
  @RequirePermissions('workflow_tasks.view')
  decide(@Param('id') id: string, @Body() dto: DecisionDto, @CurrentUser() user: AuthUser) {
    return this.service.decideTask(id, dto, user);
  }
}
