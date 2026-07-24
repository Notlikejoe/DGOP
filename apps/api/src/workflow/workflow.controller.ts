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
  AddWorkflowAttachmentDto,
  AddWorkflowCommentDto,
  CreateWorkflowDelegationDto,
  CreateCaseDto,
  CreateWorkflowTemplateDto,
  DecisionDto,
  ListMyTasksDto,
  ListWorkflowCasesDto,
  SaveWorkflowBpmnDto,
  SubmitWorkflowTaskFormDto,
  SubmitAssignmentDto,
  WorkflowTemplateMigrationExecuteDto,
  WorkflowTemplateRollbackDto,
  UpdateWorkflowDelegationDto,
  UpdateCaseDto,
  UpdateTaskDto,
  UpsertWorkflowSlaTemplateDto,
  WorkflowDesignerMigrationPreviewDto,
  WorkflowDesignerSimulationDto,
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

  @Post('templates')
  @RequirePermissions('workflow_cases.edit')
  createTemplate(@Body() dto: CreateWorkflowTemplateDto, @CurrentUser() user: AuthUser) {
    return this.service.createDesignerTemplate(dto, user);
  }

  @Get('templates/:id/designer')
  @RequirePermissions('workflow_cases.view')
  templateDesigner(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.service.getTemplateDesigner(id, user.roles);
  }

  @Post('templates/:id/designer/save')
  @RequirePermissions('workflow_cases.edit')
  saveTemplateDesigner(@Param('id') id: string, @Body() dto: SaveWorkflowBpmnDto, @CurrentUser() user: AuthUser) {
    return this.service.saveTemplateBpmnDraft(id, dto, user);
  }

  @Post('templates/:id/designer/publish')
  @RequirePermissions('workflow_cases.edit')
  publishTemplateDesigner(@Param('id') id: string, @Body() dto: SaveWorkflowBpmnDto, @CurrentUser() user: AuthUser) {
    return this.service.publishTemplateBpmn(id, dto, user);
  }

  @Post('templates/:id/designer/simulate')
  @RequirePermissions('workflow_cases.edit')
  simulateTemplateDesigner(
    @Param('id') id: string,
    @Body() dto: WorkflowDesignerSimulationDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.service.simulateTemplateDesigner(id, dto, user);
  }

  @Post('templates/:id/designer/migration-preview')
  @RequirePermissions('workflow_cases.edit')
  migrationPreview(
    @Param('id') id: string,
    @Body() dto: WorkflowDesignerMigrationPreviewDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.service.workflowTemplateMigrationPreview(id, dto, user);
  }

  @Get('templates/:id/designer/versions')
  @RequirePermissions('workflow_cases.view')
  templateVersions(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.service.listTemplateVersions(id, user);
  }

  @Get('templates/:id/designer/versions/:version/diff')
  @RequirePermissions('workflow_cases.view')
  templateVersionDiff(@Param('id') id: string, @Param('version') version: string, @CurrentUser() user: AuthUser) {
    return this.service.templateVersionDiff(id, Number(version), user);
  }

  @Post('templates/:id/designer/rollback')
  @RequirePermissions('workflow_cases.edit')
  rollbackTemplateVersion(@Param('id') id: string, @Body() dto: WorkflowTemplateRollbackDto, @CurrentUser() user: AuthUser) {
    return this.service.rollbackTemplateVersion(id, dto, user);
  }

  @Post('templates/:id/designer/migrate-active-cases')
  @RequirePermissions('workflow_cases.edit')
  migrateTemplateCases(@Param('id') id: string, @Body() dto: WorkflowTemplateMigrationExecuteDto, @CurrentUser() user: AuthUser) {
    return this.service.migrateTemplateActiveCases(id, dto, user);
  }

  @Get('graph')
  @RequirePermissions('workflow_cases.view')
  graph(@CurrentUser() user: AuthUser) {
    return this.service.graph(user.roles, user);
  }

  @Get('dashboard')
  @RequirePermissions('workflow_cases.view')
  dashboard(@CurrentUser() user: AuthUser) {
    return this.service.dashboard(user.roles, user);
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

  @Get('delegations')
  @RequirePermissions('workflow_tasks.view')
  delegations(@CurrentUser() user: AuthUser) {
    return this.service.listDelegations(user);
  }

  @Post('delegations')
  @RequirePermissions('workflow_tasks.edit')
  createDelegation(@Body() dto: CreateWorkflowDelegationDto, @CurrentUser() user: AuthUser) {
    return this.service.createDelegation(dto, user);
  }

  @Patch('delegations/:id')
  @RequirePermissions('workflow_tasks.edit')
  updateDelegation(@Param('id') id: string, @Body() dto: UpdateWorkflowDelegationDto, @CurrentUser() user: AuthUser) {
    return this.service.updateDelegationStatus(id, dto, user);
  }

  @Get('sla-templates')
  @RequirePermissions('workflow_cases.view')
  slaTemplates(@CurrentUser() user: AuthUser) {
    return this.service.listPersistentSlaTemplates(user.roles);
  }

  @Post('sla-templates')
  @RequirePermissions('workflow_cases.edit')
  upsertSlaTemplate(@Body() dto: UpsertWorkflowSlaTemplateDto, @CurrentUser() user: AuthUser) {
    return this.service.upsertSlaTemplate(dto, user);
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

  @Get('cases/:id/comments')
  @RequirePermissions('workflow_cases.view')
  caseComments(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.service.listCaseComments(id, user);
  }

  @Post('cases/:id/comments')
  @RequirePermissions('workflow_tasks.edit')
  addCaseComment(@Param('id') id: string, @Body() dto: AddWorkflowCommentDto, @CurrentUser() user: AuthUser) {
    return this.service.addCaseComment(id, dto, user);
  }

  @Get('cases/:id/attachments')
  @RequirePermissions('workflow_cases.view')
  caseAttachments(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.service.listCaseAttachments(id, user);
  }

  @Post('cases/:id/attachments')
  @RequirePermissions('workflow_tasks.edit')
  addCaseAttachment(@Param('id') id: string, @Body() dto: AddWorkflowAttachmentDto, @CurrentUser() user: AuthUser) {
    return this.service.addCaseAttachment(id, dto, user);
  }

  @Patch('cases/:id')
  @RequirePermissions('workflow_cases.edit')
  updateCase(@Param('id') id: string, @Body() dto: UpdateCaseDto, @CurrentUser() user: AuthUser) {
    return this.service.updateCase(id, dto, user.roles, user.email, user);
  }

  @Post('cases/:id/submit')
  @RequirePermissions('workflow_cases.edit')
  submitCase(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.service.submitCase(id, user.roles, user.email, user);
  }

  @Post('cases/:id/tasks')
  @RequirePermissions('workflow_tasks.create')
  addTask(@Param('id') id: string, @Body() dto: AddTaskDto, @CurrentUser() user: AuthUser) {
    return this.service.addTask(id, dto, user.roles, user.email, user);
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
    return this.service.getTask(id, user.roles, user);
  }

  @Patch('tasks/:id')
  @RequirePermissions('workflow_tasks.edit')
  updateTask(@Param('id') id: string, @Body() dto: UpdateTaskDto, @CurrentUser() user: AuthUser) {
    return this.service.updateTask(id, dto, user.roles, user.email, user);
  }

  @Post('tasks/:id/form')
  @RequirePermissions('workflow_tasks.edit')
  submitTaskForm(@Param('id') id: string, @Body() dto: SubmitWorkflowTaskFormDto, @CurrentUser() user: AuthUser) {
    return this.service.submitTaskForm(id, dto, user);
  }

  @Post('tasks/:id/decision')
  @RequirePermissions('workflow_tasks.edit')
  decide(@Param('id') id: string, @Body() dto: DecisionDto, @CurrentUser() user: AuthUser) {
    return this.service.decideTask(id, dto, user);
  }
}
