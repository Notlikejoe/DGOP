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
import { CurrentUser, RequirePermissions } from '../auth/decorators';
import { AuthUser } from '../auth/auth.types';
import { TrainingService } from './training.service';
import {
  CompleteTrainingAssignmentDto,
  CreateCertificationAttemptDto,
  CreateCertificationTrackDto,
  CreateCommunityArticleDto,
  CreateContinuingEducationDto,
  CreateMentorshipPairDto,
  CreateTrainingAssignmentDto,
  CreateTrainingCourseDto,
  UpdateTrainingAssignmentDto,
  UpdateCertificationTrackDto,
  UpdateTrainingCourseDto,
  UpsertExpertProfileDto,
  UpsertTrainingRequirementDto,
} from './training.dto';

@Controller('training')
export class TrainingController {
  constructor(private readonly service: TrainingService) {}

  @Get('summary')
  @RequirePermissions('training_assignments.view')
  summary(@CurrentUser() user: AuthUser) {
    return this.service.summary(user);
  }

  @Get('courses')
  @RequirePermissions('training_courses.view')
  courses(@Query('search') search?: string, @Query('status') status?: string) {
    return this.service.listCourses({ search, status });
  }

  @Post('courses')
  @RequirePermissions('training_courses.create')
  createCourse(@Body() dto: CreateTrainingCourseDto, @CurrentUser() user: AuthUser) {
    return this.service.createCourse(dto, user.email);
  }

  @Patch('courses/:id')
  @RequirePermissions('training_courses.edit')
  updateCourse(@Param('id') id: string, @Body() dto: UpdateTrainingCourseDto, @CurrentUser() user: AuthUser) {
    return this.service.updateCourse(id, dto, user.email);
  }

  @Delete('courses/:id')
  @RequirePermissions('training_courses.delete')
  removeCourse(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.service.removeCourse(id, user.email);
  }

  @Get('requirements')
  @RequirePermissions('training_requirements.view')
  requirements() {
    return this.service.listRequirements();
  }

  @Post('requirements')
  @RequirePermissions('training_requirements.create')
  upsertRequirement(@Body() dto: UpsertTrainingRequirementDto, @CurrentUser() user: AuthUser) {
    return this.service.upsertRequirement(dto, user.email);
  }

  @Delete('requirements/:id')
  @RequirePermissions('training_requirements.delete')
  removeRequirement(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.service.removeRequirement(id, user.email);
  }

  @Get('assignments')
  @RequirePermissions('training_assignments.view')
  assignments(
    @CurrentUser() user: AuthUser,
    @Query('status') status?: string,
    @Query('courseId') courseId?: string,
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
  ) {
    return this.service.listAssignments(user, { status, courseId }, page, pageSize);
  }

  @Post('assignments')
  @RequirePermissions('training_assignments.create')
  createAssignment(@Body() dto: CreateTrainingAssignmentDto, @CurrentUser() user: AuthUser) {
    return this.service.createAssignment(dto, user.email);
  }

  @Patch('assignments/:id')
  @RequirePermissions('training_assignments.edit')
  updateAssignment(@Param('id') id: string, @Body() dto: UpdateTrainingAssignmentDto, @CurrentUser() user: AuthUser) {
    return this.service.updateAssignment(id, dto, user);
  }

  @Post('assignments/:id/complete')
  @RequirePermissions('training_assignments.edit')
  completeAssignment(@Param('id') id: string, @Body() dto: CompleteTrainingAssignmentDto, @CurrentUser() user: AuthUser) {
    return this.service.completeAssignment(id, dto, user);
  }

  @Post('assignments/sync')
  @RequirePermissions('training_assignments.create')
  sync(@CurrentUser() user: AuthUser) {
    return this.service.syncRoleRequirements(user.email);
  }

  @Get('certifications/tracks')
  @RequirePermissions('certification_tracks.view')
  certificationTracks() {
    return this.service.listCertificationTracks();
  }

  @Post('certifications/tracks')
  @RequirePermissions('certification_tracks.create')
  createCertificationTrack(@Body() dto: CreateCertificationTrackDto, @CurrentUser() user: AuthUser) {
    return this.service.createCertificationTrack(dto, user.email);
  }

  @Patch('certifications/tracks/:id')
  @RequirePermissions('certification_tracks.edit')
  updateCertificationTrack(
    @Param('id') id: string,
    @Body() dto: UpdateCertificationTrackDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.service.updateCertificationTrack(id, dto, user.email);
  }

  @Get('certifications/attempts')
  @RequirePermissions('certification_attempts.view')
  certificationAttempts(
    @CurrentUser() user: AuthUser,
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
  ) {
    return this.service.listCertificationAttempts(user, page, pageSize);
  }

  @Post('certifications/attempts')
  @RequirePermissions('certification_attempts.create')
  createCertificationAttempt(@Body() dto: CreateCertificationAttemptDto, @CurrentUser() user: AuthUser) {
    return this.service.createCertificationAttempt(dto, user.email);
  }

  @Get('continuing-education')
  @RequirePermissions('ce_activities.view')
  continuingEducation(
    @CurrentUser() user: AuthUser,
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
  ) {
    return this.service.listContinuingEducation(user, page, pageSize);
  }

  @Post('continuing-education')
  @RequirePermissions('ce_activities.create')
  createContinuingEducation(@Body() dto: CreateContinuingEducationDto, @CurrentUser() user: AuthUser) {
    return this.service.createContinuingEducation(dto, user);
  }

  @Get('community/articles')
  @RequirePermissions('community_articles.view')
  communityArticles(@Query('page') page?: string, @Query('pageSize') pageSize?: string) {
    return this.service.listCommunityArticles(page, pageSize);
  }

  @Post('community/articles')
  @RequirePermissions('community_articles.create')
  createCommunityArticle(@Body() dto: CreateCommunityArticleDto, @CurrentUser() user: AuthUser) {
    return this.service.createCommunityArticle(dto, user.email);
  }

  @Get('community/experts')
  @RequirePermissions('expert_profiles.view')
  expertProfiles(@Query('page') page?: string, @Query('pageSize') pageSize?: string) {
    return this.service.listExpertProfiles(page, pageSize);
  }

  @Post('community/experts')
  @RequirePermissions('expert_profiles.create')
  upsertExpertProfile(@Body() dto: UpsertExpertProfileDto, @CurrentUser() user: AuthUser) {
    return this.service.upsertExpertProfile(dto, user.email);
  }

  @Get('mentorships')
  @RequirePermissions('mentorship_pairs.view')
  mentorships(
    @CurrentUser() user: AuthUser,
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
  ) {
    return this.service.listMentorships(user, page, pageSize);
  }

  @Post('mentorships')
  @RequirePermissions('mentorship_pairs.create')
  createMentorship(@Body() dto: CreateMentorshipPairDto, @CurrentUser() user: AuthUser) {
    return this.service.createMentorship(dto, user.email);
  }
}
