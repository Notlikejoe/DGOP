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
  ListMyTasksDto,
  ListWorkflowCasesDto,
  SubmitAssignmentDto,
  UpdateCaseDto,
  UpdateTaskDto,
  WorkflowRoutePreviewDto,
} from './workflow.dto';
import { CurrentUser, RequirePermissions } from '../auth/decorators';
import { AuthUser } from '../auth/auth.types';

@Controller('workflow')
export class WorkflowController {
  constructor(private readonly service: WorkflowService) {}

  // ----- route templates / graph -----
  @Get('templates')
  @RequirePermissions('workflow_cases.view')
  templates(@CurrentUser() user: AuthUser) {
    return this.service.listTemplates(user.roles);
  }

  @Get('graph')
  @RequirePermissions('workflow_cases.view')
  graph(@CurrentUser() user: AuthUser) {
    return this.service.graph(user.roles, user);
  }

  @Get('configuration')
  @RequirePermissions('workflow_cases.view')
  configuration(@CurrentUser() user: AuthUser) {
    return this.service.configuration(user.roles, user);
  }

  @Get('case-management')
  @RequirePermissions('workflow_cases.view')
  caseManagement(@CurrentUser() user: AuthUser) {
    return this.service.caseManagement(user.roles, user);
  }

  @Post('route-preview')
  @RequirePermissions('workflow_cases.view')
  routePreview(@Body() dto: WorkflowRoutePreviewDto, @CurrentUser() user: AuthUser) {
    return this.service.routePreview(dto, user.roles);
  }

  @Post('maintenance')
  @RequirePermissions('workflow_cases.edit')
  maintenance(@CurrentUser() user: AuthUser) {
    return this.service.runMaintenance(user);
  }

  // ----- cases -----
  @Get('cases')
  @RequirePermissions('workflow_cases.view')
  listCases(@CurrentUser() user: AuthUser, @Query() query: ListWorkflowCasesDto) {
    return this.service.listCases(user.roles, query, user);
  }

  @Post('cases')
  @RequirePermissions('workflow_cases.create')
  createCase(@Body() dto: CreateCaseDto, @CurrentUser() user: AuthUser) {
    return this.service.createCase(dto, user.roles, user.email);
  }

  @Get('cases/:id')
  @RequirePermissions('workflow_cases.view')
  getCase(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.service.getCase(user.roles, id, user);
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
  myTasks(@CurrentUser() user: AuthUser, @Query() query: ListMyTasksDto) {
    return this.service.listMyTasks(user, query);
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
  @RequirePermissions('workflow_tasks.edit')
  decide(@Param('id') id: string, @Body() dto: DecisionDto, @CurrentUser() user: AuthUser) {
    return this.service.decideTask(id, dto, user);
  }
}
