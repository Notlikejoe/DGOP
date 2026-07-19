import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { CertificationAttemptStatus, TrainingAssignmentStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { AuthUser } from '../auth/auth.types';
import { boundedFirstPageParams, parsePageParams, toPaged } from '../common/pagination';
import { parseQueryEnum } from '../common/query-filters';
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
import { assignmentEffectiveStatus, awarenessReadinessScore, certificationState } from './training.logic';

const ADMIN_ROLES = ['system_admin', 'dmo_admin'];
const openStatuses: TrainingAssignmentStatus[] = [
  TrainingAssignmentStatus.assigned,
  TrainingAssignmentStatus.in_progress,
];

const courseInclude = {
  prerequisiteCourse: { select: { id: true, code: true, titleEn: true, titleAr: true } },
  requirements: {
    include: {
      role: { select: { id: true, code: true, nameEn: true, nameAr: true } },
    },
    orderBy: { createdAt: 'asc' as const },
  },
};

const assignmentInclude = {
  course: { select: { id: true, code: true, titleEn: true, titleAr: true, category: true, validityMonths: true } },
  user: { select: { id: true, email: true, displayName: true } },
  person: { select: { id: true, fullNameEn: true, fullNameAr: true } },
};

@Injectable()
export class TrainingService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  private isAdmin(user: AuthUser): boolean {
    return user.roles.some((r) => ADMIN_ROLES.includes(r));
  }

  private addMonths(date: Date, months: number | null | undefined): Date | null {
    if (!months) return null;
    const next = new Date(date);
    next.setMonth(next.getMonth() + months);
    return next;
  }

  private async expireCompleted(): Promise<number> {
    const result = await this.prisma.trainingAssignment.updateMany({
      where: { status: TrainingAssignmentStatus.completed, expiresAt: { lt: new Date() } },
      data: { status: TrainingAssignmentStatus.expired },
    });
    return result.count;
  }

  private async assertCourse(id: string): Promise<void> {
    const course = await this.prisma.trainingCourse.findFirst({ where: { id, deletedAt: null } });
    if (!course) throw new BadRequestException('Training course not found');
  }

  private async assertPrerequisiteCourse(
    prerequisiteCourseId: string | null | undefined,
    courseId?: string,
  ): Promise<string | null | undefined> {
    if (prerequisiteCourseId === undefined) return undefined;
    if (!prerequisiteCourseId) return null;
    if (courseId && prerequisiteCourseId === courseId) {
      throw new BadRequestException('Training course cannot require itself');
    }
    const prerequisite = await this.prisma.trainingCourse.findFirst({
      where: { id: prerequisiteCourseId, deletedAt: null },
      select: { id: true, prerequisiteCourseId: true },
    });
    if (!prerequisite) throw new BadRequestException('Prerequisite course not found');
    if (!courseId) return prerequisiteCourseId;

    const seen = new Set<string>();
    let nextPrerequisiteId = prerequisite.prerequisiteCourseId;
    while (nextPrerequisiteId) {
      if (nextPrerequisiteId === courseId) {
        throw new BadRequestException('Prerequisite course chain would create a cycle');
      }
      if (seen.has(nextPrerequisiteId)) break;
      seen.add(nextPrerequisiteId);
      const next = await this.prisma.trainingCourse.findFirst({
        where: { id: nextPrerequisiteId, deletedAt: null },
        select: { id: true, prerequisiteCourseId: true },
      });
      nextPrerequisiteId = next?.prerequisiteCourseId ?? null;
    }
    return prerequisiteCourseId;
  }

  private async assertUser(id: string): Promise<{ personId: string | null }> {
    const user = await this.prisma.user.findFirst({
      where: { id, isActive: true },
      include: { person: true },
    });
    if (!user) throw new BadRequestException('User account not found');
    return { personId: user.person?.id ?? null };
  }

  async summary(user: AuthUser) {
    const now = new Date();
    const where = this.isAdmin(user) ? {} : { userId: user.id };
    const mentorshipWhere = this.isAdmin(user) ? undefined : { OR: [{ mentor: { userId: user.id } }, { mentee: { userId: user.id } }] };
    const [courses, requirements, total, completed, expired, overdue, tracks, certified, ceAgg, articles, experts, mentorships] = await Promise.all([
      this.prisma.trainingCourse.count({ where: { deletedAt: null, isActive: true } }),
      this.prisma.trainingRequirement.count({ where: { mandatory: true } }),
      this.prisma.trainingAssignment.count({ where }),
      this.prisma.trainingAssignment.count({
        where: {
          ...where,
          status: TrainingAssignmentStatus.completed,
          OR: [{ expiresAt: null }, { expiresAt: { gte: now } }],
        },
      }),
      this.prisma.trainingAssignment.count({
        where: {
          ...where,
          OR: [
            { status: TrainingAssignmentStatus.expired },
            { status: TrainingAssignmentStatus.completed, expiresAt: { lt: now } },
          ],
        },
      }),
      this.prisma.trainingAssignment.count({
        where: { ...where, status: { in: openStatuses }, dueDate: { lt: now } },
      }),
      this.prisma.certificationTrack.count({ where: { deletedAt: null, isActive: true } }),
      this.prisma.certificationAttempt.count({
        where: { ...where, status: CertificationAttemptStatus.passed, OR: [{ expiresAt: null }, { expiresAt: { gte: now } }] },
      }),
      this.prisma.continuingEducationActivity.aggregate({ where, _sum: { hours: true } }),
      this.prisma.communityArticle.count({ where: { deletedAt: null, status: 'published' } }),
      this.prisma.expertProfile.count({ where: { isActive: true } }),
      this.prisma.mentorshipPair.count({ where: mentorshipWhere }),
    ]);
    const ceHours = ceAgg._sum.hours ?? 0;
    return {
      courses,
      mandatoryRequirements: requirements,
      assignments: total,
      completed,
      expired,
      overdue,
      completionRate: total ? Math.round((completed / total) * 100) : 0,
      certificationTracks: tracks,
      activeCertifications: certified,
      ceHours,
      communityArticles: articles,
      experts,
      mentorships,
      awarenessReadiness: awarenessReadinessScore({
        assignments: total,
        completed,
        expired,
        overdue,
        certifications: tracks,
        certified,
        ceHours,
        mentorships,
      }),
    };
  }

  async listCourses(filters: { search?: string; status?: string }) {
    const where: Record<string, unknown> = { deletedAt: null };
    if (filters.status === 'active') where['isActive'] = true;
    if (filters.status === 'inactive') where['isActive'] = false;
    if (filters.search) {
      const term = filters.search.trim();
      where['OR'] = [
        { code: { contains: term, mode: 'insensitive' } },
        { titleEn: { contains: term, mode: 'insensitive' } },
        { titleAr: { contains: term, mode: 'insensitive' } },
      ];
    }
    return this.prisma.trainingCourse.findMany({
      where,
      include: courseInclude,
      orderBy: [{ tier: 'asc' }, { category: 'asc' }, { code: 'asc' }],
    });
  }

  async createCourse(dto: CreateTrainingCourseDto, actor: string) {
    const prerequisiteCourseId = await this.assertPrerequisiteCourse(dto.prerequisiteCourseId ?? null);
    const course = await this.prisma.trainingCourse.create({
      data: {
        code: dto.code,
        titleEn: dto.titleEn,
        titleAr: dto.titleAr,
        description: dto.description ?? null,
        category: dto.category ?? 'governance',
        tier: dto.tier ?? 'tier_1',
        deliveryMethod: dto.deliveryMethod ?? 'self_paced',
        prerequisiteCourseId: prerequisiteCourseId ?? null,
        durationMinutes: dto.durationMinutes ?? 30,
        validityMonths: dto.validityMonths ?? null,
        isActive: dto.isActive ?? true,
      },
      include: courseInclude,
    });
    await this.audit.log({
      actor,
      action: 'training_course.create',
      entityType: 'training_course',
      entityId: course.id,
      metadata: { code: course.code },
    });
    return course;
  }

  async updateCourse(id: string, dto: UpdateTrainingCourseDto, actor: string) {
    const existing = await this.prisma.trainingCourse.findFirst({ where: { id, deletedAt: null } });
    if (!existing) throw new NotFoundException('training course not found');
    const prerequisiteCourseId =
      dto.prerequisiteCourseId !== undefined
        ? await this.assertPrerequisiteCourse(dto.prerequisiteCourseId, id)
        : undefined;
    const course = await this.prisma.trainingCourse.update({
      where: { id },
      data: {
        code: dto.code,
        titleEn: dto.titleEn,
        titleAr: dto.titleAr,
        description: dto.description,
        category: dto.category,
        tier: dto.tier,
        deliveryMethod: dto.deliveryMethod,
        prerequisiteCourseId,
        durationMinutes: dto.durationMinutes,
        validityMonths: dto.validityMonths,
        isActive: dto.isActive,
      },
      include: courseInclude,
    });
    await this.audit.log({ actor, action: 'training_course.update', entityType: 'training_course', entityId: id });
    return course;
  }

  async removeCourse(id: string, actor: string) {
    const existing = await this.prisma.trainingCourse.findFirst({ where: { id, deletedAt: null } });
    if (!existing) throw new NotFoundException('training course not found');
    await this.prisma.trainingCourse.update({ where: { id }, data: { deletedAt: new Date(), isActive: false } });
    await this.audit.log({ actor, action: 'training_course.delete', entityType: 'training_course', entityId: id });
    return { success: true };
  }

  async listRequirements() {
    return this.prisma.trainingRequirement.findMany({
      include: {
        course: { select: { id: true, code: true, titleEn: true, titleAr: true } },
        role: { select: { id: true, code: true, nameEn: true, nameAr: true } },
      },
      orderBy: [{ createdAt: 'desc' }],
    });
  }

  async upsertRequirement(dto: UpsertTrainingRequirementDto, actor: string) {
    await this.assertCourse(dto.courseId);
    const role = await this.prisma.role.findFirst({ where: { id: dto.roleId, deletedAt: null } });
    if (!role) throw new BadRequestException('Role not found');
    const req = await this.prisma.trainingRequirement.upsert({
      where: { courseId_roleId: { courseId: dto.courseId, roleId: dto.roleId } },
      update: {
        mandatory: dto.mandatory ?? true,
        dueDays: dto.dueDays ?? 30,
        validityMonths: dto.validityMonths ?? null,
      },
      create: {
        courseId: dto.courseId,
        roleId: dto.roleId,
        mandatory: dto.mandatory ?? true,
        dueDays: dto.dueDays ?? 30,
        validityMonths: dto.validityMonths ?? null,
      },
      include: {
        course: { select: { id: true, code: true, titleEn: true, titleAr: true } },
        role: { select: { id: true, code: true, nameEn: true, nameAr: true } },
      },
    });
    await this.audit.log({
      actor,
      action: 'training_requirement.upsert',
      entityType: 'training_requirement',
      entityId: req.id,
    });
    return req;
  }

  async removeRequirement(id: string, actor: string) {
    const existing = await this.prisma.trainingRequirement.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException('training requirement not found');
    await this.prisma.trainingRequirement.delete({ where: { id } });
    await this.audit.log({ actor, action: 'training_requirement.delete', entityType: 'training_requirement', entityId: id });
    return { success: true };
  }

  async listAssignments(
    user: AuthUser,
    filters: { status?: string; courseId?: string },
    page?: string | number,
    pageSize?: string | number,
  ) {
    const now = new Date();
    const where: Record<string, unknown> = this.isAdmin(user) ? {} : { userId: user.id };
    const status = parseQueryEnum<TrainingAssignmentStatus>(
      filters.status,
      Object.values(TrainingAssignmentStatus),
      'training assignment status',
      (value) => value.toLowerCase(),
    );
    if (status === TrainingAssignmentStatus.expired) {
      where['OR'] = [
        { status: TrainingAssignmentStatus.expired },
        { status: TrainingAssignmentStatus.completed, expiresAt: { lt: now } },
      ];
    } else if (status) {
      where['status'] = status;
    }
    if (filters.courseId) where['courseId'] = filters.courseId;
    const params = parsePageParams(page, pageSize);
    const query = {
      where,
      include: assignmentInclude,
      orderBy: [{ dueDate: 'asc' as const }, { createdAt: 'desc' as const }],
    };
    let rows;
    let total = 0;
    if (params) {
      [rows, total] = await Promise.all([
        this.prisma.trainingAssignment.findMany({ ...query, skip: params.skip, take: params.take }),
        this.prisma.trainingAssignment.count({ where }),
      ]);
    } else {
      const bounded = boundedFirstPageParams();
      rows = await this.prisma.trainingAssignment.findMany({ ...query, skip: bounded.skip, take: bounded.take });
    }
    const mapped = rows.map((row) => ({
      ...row,
      status: assignmentEffectiveStatus(row.status, row.expiresAt, now),
    }));
    return params ? toPaged(mapped, total, params) : mapped;
  }

  async createAssignment(dto: CreateTrainingAssignmentDto, actor: string) {
    await this.assertCourse(dto.courseId);
    const userInfo = await this.assertUser(dto.userId);
    const existing = await this.prisma.trainingAssignment.findFirst({
      where: {
        courseId: dto.courseId,
        userId: dto.userId,
        status: { in: openStatuses },
      },
    });
    if (existing) throw new BadRequestException('User already has an open assignment for this course');
    const assignment = await this.prisma.trainingAssignment.create({
      data: {
        courseId: dto.courseId,
        userId: dto.userId,
        personId: dto.personId ?? userInfo.personId,
        dueDate: dto.dueDate ? new Date(dto.dueDate) : null,
        assignedBy: actor,
        source: dto.source ?? 'manual',
      },
      include: assignmentInclude,
    });
    await this.audit.log({
      actor,
      action: 'training_assignment.create',
      entityType: 'training_assignment',
      entityId: assignment.id,
    });
    return assignment;
  }

  async updateAssignment(id: string, dto: UpdateTrainingAssignmentDto, user: AuthUser) {
    const existing = await this.prisma.trainingAssignment.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException('training assignment not found');
    if (!this.isAdmin(user) && existing.userId !== user.id) {
      throw new ForbiddenException('You can only update your own training assignment');
    }
    const assignment = await this.prisma.trainingAssignment.update({
      where: { id },
      data: {
        status: dto.status,
        dueDate: dto.dueDate !== undefined ? (dto.dueDate ? new Date(dto.dueDate) : null) : undefined,
        evidenceNote: dto.evidenceNote,
      },
      include: assignmentInclude,
    });
    await this.audit.log({ actor: user.email, action: 'training_assignment.update', entityType: 'training_assignment', entityId: id });
    return assignment;
  }

  async completeAssignment(id: string, dto: CompleteTrainingAssignmentDto, user: AuthUser) {
    const existing = await this.prisma.trainingAssignment.findUnique({
      where: { id },
      include: { course: true },
    });
    if (!existing) throw new NotFoundException('training assignment not found');
    if (!this.isAdmin(user) && existing.userId !== user.id) {
      throw new ForbiddenException('You can only complete your own training assignment');
    }
    const completedAt = new Date();
    const expiresAt = this.addMonths(completedAt, existing.course.validityMonths);
    const assignment = await this.prisma.trainingAssignment.update({
      where: { id },
      data: {
        status: TrainingAssignmentStatus.completed,
        completedAt,
        expiresAt,
        score: dto.score ?? null,
        evidenceNote: dto.evidenceNote ?? null,
      },
      include: assignmentInclude,
    });
    await this.audit.log({
      actor: user.email,
      action: 'training_assignment.complete',
      entityType: 'training_assignment',
      entityId: id,
      metadata: { courseId: existing.courseId, expiresAt },
    });
    return assignment;
  }

  async syncRoleRequirements(actor: string) {
    const expired = await this.expireCompleted();
    const requirements = await this.prisma.trainingRequirement.findMany({
      include: { course: true },
    });
    let created = 0;
    for (const req of requirements) {
      if (!req.course.isActive || req.course.deletedAt) continue;
      const holders = await this.prisma.userRole.findMany({
        where: { roleId: req.roleId },
        include: { user: { include: { person: true } } },
      });
      for (const holder of holders) {
        const current = await this.prisma.trainingAssignment.findFirst({
          where: {
            courseId: req.courseId,
            userId: holder.userId,
            OR: [
              { status: { in: openStatuses } },
              {
                status: TrainingAssignmentStatus.completed,
                OR: [{ expiresAt: null }, { expiresAt: { gte: new Date() } }],
              },
            ],
          },
        });
        if (current) continue;
        const dueDate = new Date();
        dueDate.setDate(dueDate.getDate() + req.dueDays);
        await this.prisma.trainingAssignment.create({
          data: {
            courseId: req.courseId,
            userId: holder.userId,
            personId: holder.user.person?.id ?? null,
            dueDate,
            assignedBy: actor,
            source: 'role_requirement',
          },
        });
        created++;
      }
    }
    await this.audit.log({
      actor,
      action: 'training_assignment.sync',
      entityType: 'training_assignment',
      entityId: 'bulk',
      metadata: { created, expired },
    });
    return { created, expired };
  }

  async listCertificationTracks() {
    return this.prisma.certificationTrack.findMany({
      where: { deletedAt: null },
      include: { attempts: { select: { id: true, status: true, expiresAt: true } } },
      orderBy: [{ level: 'asc' }, { code: 'asc' }],
    });
  }

  async createCertificationTrack(dto: CreateCertificationTrackDto, actor: string) {
    const track = await this.prisma.certificationTrack.create({
      data: {
        code: dto.code,
        level: dto.level,
        nameEn: dto.nameEn,
        nameAr: dto.nameAr,
        description: dto.description ?? null,
        requiredTier: dto.requiredTier ?? 'tier_1',
        requiredCeHours: dto.requiredCeHours ?? 0,
        validityMonths: dto.validityMonths ?? 24,
        passScore: dto.passScore ?? 80,
        privileges: dto.privileges ?? null,
        isActive: dto.isActive ?? true,
      },
    });
    await this.audit.log({
      actor,
      action: 'certification_track.create',
      entityType: 'certification_track',
      entityId: track.id,
      metadata: { code: track.code, level: track.level },
    });
    return track;
  }

  async updateCertificationTrack(id: string, dto: UpdateCertificationTrackDto, actor: string) {
    const existing = await this.prisma.certificationTrack.findFirst({ where: { id, deletedAt: null } });
    if (!existing) throw new NotFoundException('certification track not found');
    const track = await this.prisma.certificationTrack.update({
      where: { id },
      data: {
        code: dto.code,
        level: dto.level,
        nameEn: dto.nameEn,
        nameAr: dto.nameAr,
        description: dto.description,
        requiredTier: dto.requiredTier,
        requiredCeHours: dto.requiredCeHours,
        validityMonths: dto.validityMonths,
        passScore: dto.passScore,
        privileges: dto.privileges,
        isActive: dto.isActive,
      },
    });
    await this.audit.log({ actor, action: 'certification_track.update', entityType: 'certification_track', entityId: id });
    return track;
  }

  async listCertificationAttempts(user: AuthUser, page?: string | number, pageSize?: string | number) {
    const where = this.isAdmin(user) ? {} : { userId: user.id };
    const params = parsePageParams(page, pageSize);
    const query = {
      where,
      include: {
        track: true,
        user: { select: { id: true, email: true, displayName: true } },
        person: { select: { id: true, fullNameEn: true, fullNameAr: true } },
      },
      orderBy: [{ updatedAt: 'desc' as const }],
    };
    let rows;
    let total = 0;
    if (params) {
      [rows, total] = await Promise.all([
        this.prisma.certificationAttempt.findMany({ ...query, skip: params.skip, take: params.take }),
        this.prisma.certificationAttempt.count({ where }),
      ]);
    } else {
      const bounded = boundedFirstPageParams(pageSize);
      rows = await this.prisma.certificationAttempt.findMany({ ...query, skip: bounded.skip, take: bounded.take });
    }
    const mapped = rows.map((row) => ({ ...row, state: certificationState(row.status, row.expiresAt) }));
    return params ? toPaged(mapped, total, params) : mapped;
  }

  async createCertificationAttempt(dto: CreateCertificationAttemptDto, actor: string) {
    const track = await this.prisma.certificationTrack.findFirst({ where: { id: dto.trackId, deletedAt: null, isActive: true } });
    if (!track) throw new BadRequestException('Certification track not found');
    const userInfo = await this.assertUser(dto.userId);
    const issuedAt = dto.issuedAt ? new Date(dto.issuedAt) : dto.status === 'passed' ? new Date() : null;
    const expiresAt = dto.expiresAt
      ? new Date(dto.expiresAt)
      : issuedAt
        ? this.addMonths(issuedAt, track.validityMonths)
        : null;
    const renewalDueAt = expiresAt ? new Date(expiresAt) : null;
    if (renewalDueAt) renewalDueAt.setDate(renewalDueAt.getDate() - 60);
    const attempt = await this.prisma.certificationAttempt.create({
      data: {
        trackId: dto.trackId,
        userId: dto.userId,
        personId: dto.personId ?? userInfo.personId,
        status: dto.status ?? 'in_progress',
        examScore: dto.examScore ?? null,
        caseStudyScore: dto.caseStudyScore ?? null,
        peerReviewScore: dto.peerReviewScore ?? null,
        issuedAt,
        expiresAt,
        renewalDueAt,
        evidenceNote: dto.evidenceNote ?? null,
        assessor: dto.assessor ?? actor,
      },
      include: { track: true, user: { select: { id: true, email: true, displayName: true } }, person: true },
    });
    await this.audit.log({
      actor,
      action: 'certification_attempt.create',
      entityType: 'certification_attempt',
      entityId: attempt.id,
      metadata: { trackId: dto.trackId, status: attempt.status },
    });
    return { ...attempt, state: certificationState(attempt.status, attempt.expiresAt) };
  }

  async listContinuingEducation(user: AuthUser, page?: string | number, pageSize?: string | number) {
    const where = this.isAdmin(user) ? {} : { userId: user.id };
    const params = parsePageParams(page, pageSize);
    const query = {
      where,
      include: {
        user: { select: { id: true, email: true, displayName: true } },
        person: { select: { id: true, fullNameEn: true, fullNameAr: true } },
      },
      orderBy: [{ activityDate: 'desc' as const }],
    };
    if (!params) {
      const bounded = boundedFirstPageParams();
      return this.prisma.continuingEducationActivity.findMany({ ...query, skip: bounded.skip, take: bounded.take });
    }
    const [rows, total] = await Promise.all([
      this.prisma.continuingEducationActivity.findMany({ ...query, skip: params.skip, take: params.take }),
      this.prisma.continuingEducationActivity.count({ where }),
    ]);
    return toPaged(rows, total, params);
  }

  async createContinuingEducation(dto: CreateContinuingEducationDto, user: AuthUser) {
    const targetUserId = this.isAdmin(user) ? dto.userId : user.id;
    if (!this.isAdmin(user) && dto.userId !== user.id) {
      throw new ForbiddenException('You can only record your own continuing education');
    }
    const userInfo = await this.assertUser(targetUserId);
    const activity = await this.prisma.continuingEducationActivity.create({
      data: {
        userId: targetUserId,
        personId: dto.personId ?? userInfo.personId,
        titleEn: dto.titleEn,
        titleAr: dto.titleAr ?? null,
        activityType: dto.activityType ?? 'course',
        hours: dto.hours,
        activityDate: dto.activityDate ? new Date(dto.activityDate) : new Date(),
        evidenceNote: dto.evidenceNote ?? null,
        approvedBy: this.isAdmin(user) ? user.email : null,
        approvedAt: this.isAdmin(user) ? new Date() : null,
      },
      include: { user: { select: { id: true, email: true, displayName: true } }, person: true },
    });
    await this.audit.log({ actor: user.email, action: 'ce_activity.create', entityType: 'ce_activity', entityId: activity.id });
    return activity;
  }

  async listCommunityArticles(page?: string | number, pageSize?: string | number) {
    const where = { deletedAt: null, status: 'published' };
    const params = parsePageParams(page, pageSize);
    const query = {
      where: { deletedAt: null, status: 'published' },
      include: { author: { select: { id: true, fullNameEn: true, fullNameAr: true } } },
      orderBy: [{ isFeatured: 'desc' as const }, { updatedAt: 'desc' as const }],
    };
    if (!params) {
      const bounded = boundedFirstPageParams();
      return this.prisma.communityArticle.findMany({ ...query, skip: bounded.skip, take: bounded.take });
    }
    const [rows, total] = await Promise.all([
      this.prisma.communityArticle.findMany({ ...query, skip: params.skip, take: params.take }),
      this.prisma.communityArticle.count({ where }),
    ]);
    return toPaged(rows, total, params);
  }

  async createCommunityArticle(dto: CreateCommunityArticleDto, actor: string) {
    if (dto.authorPersonId) {
      const person = await this.prisma.person.findFirst({ where: { id: dto.authorPersonId, deletedAt: null } });
      if (!person) throw new BadRequestException('Author person not found');
    }
    const article = await this.prisma.communityArticle.create({
      data: {
        titleEn: dto.titleEn,
        titleAr: dto.titleAr,
        summaryEn: dto.summaryEn ?? null,
        summaryAr: dto.summaryAr ?? null,
        content: dto.content ?? null,
        category: dto.category ?? 'best_practice',
        authorPersonId: dto.authorPersonId ?? null,
        contributionPoints: dto.contributionPoints ?? 0,
        isFeatured: dto.isFeatured ?? false,
      },
      include: { author: { select: { id: true, fullNameEn: true, fullNameAr: true } } },
    });
    await this.audit.log({ actor, action: 'community_article.create', entityType: 'community_article', entityId: article.id });
    return article;
  }

  async listExpertProfiles(page?: string | number, pageSize?: string | number) {
    const where = { isActive: true };
    const params = parsePageParams(page, pageSize);
    const query = {
      where: { isActive: true },
      include: { person: { select: { id: true, fullNameEn: true, fullNameAr: true, email: true, jobTitle: true } } },
      orderBy: [{ contributionPoints: 'desc' as const }, { expertiseArea: 'asc' as const }],
    };
    if (!params) {
      const bounded = boundedFirstPageParams();
      return this.prisma.expertProfile.findMany({ ...query, skip: bounded.skip, take: bounded.take });
    }
    const [rows, total] = await Promise.all([
      this.prisma.expertProfile.findMany({ ...query, skip: params.skip, take: params.take }),
      this.prisma.expertProfile.count({ where }),
    ]);
    return toPaged(rows, total, params);
  }

  async upsertExpertProfile(dto: UpsertExpertProfileDto, actor: string) {
    const person = await this.prisma.person.findFirst({ where: { id: dto.personId, deletedAt: null } });
    if (!person) throw new BadRequestException('Person not found');
    const profile = await this.prisma.expertProfile.upsert({
      where: { personId: dto.personId },
      update: {
        expertiseArea: dto.expertiseArea,
        bio: dto.bio,
        contributionPoints: dto.contributionPoints,
        mentorshipCapacity: dto.mentorshipCapacity,
        isMentor: dto.isMentor,
        isActive: dto.isActive,
      },
      create: {
        personId: dto.personId,
        expertiseArea: dto.expertiseArea,
        bio: dto.bio ?? null,
        contributionPoints: dto.contributionPoints ?? 0,
        mentorshipCapacity: dto.mentorshipCapacity ?? 1,
        isMentor: dto.isMentor ?? true,
        isActive: dto.isActive ?? true,
      },
      include: { person: { select: { id: true, fullNameEn: true, fullNameAr: true, email: true, jobTitle: true } } },
    });
    await this.audit.log({ actor, action: 'expert_profile.upsert', entityType: 'expert_profile', entityId: profile.id });
    return profile;
  }

  async listMentorships(user: AuthUser, page?: string | number, pageSize?: string | number) {
    const where = this.isAdmin(user) ? {} : { OR: [{ mentor: { userId: user.id } }, { mentee: { userId: user.id } }] };
    const params = parsePageParams(page, pageSize);
    const query = {
      where,
      include: {
        mentor: { select: { id: true, fullNameEn: true, fullNameAr: true, email: true } },
        mentee: { select: { id: true, fullNameEn: true, fullNameAr: true, email: true } },
      },
      orderBy: [{ updatedAt: 'desc' as const }],
    };
    if (!params) {
      const bounded = boundedFirstPageParams();
      return this.prisma.mentorshipPair.findMany({ ...query, skip: bounded.skip, take: bounded.take });
    }
    const [rows, total] = await Promise.all([
      this.prisma.mentorshipPair.findMany({ ...query, skip: params.skip, take: params.take }),
      this.prisma.mentorshipPair.count({ where }),
    ]);
    return toPaged(rows, total, params);
  }

  async createMentorship(dto: CreateMentorshipPairDto, actor: string) {
    if (dto.mentorPersonId === dto.menteePersonId) {
      throw new BadRequestException('Mentor and mentee must be different people');
    }
    const [mentor, mentee] = await Promise.all([
      this.prisma.person.findFirst({ where: { id: dto.mentorPersonId, deletedAt: null } }),
      this.prisma.person.findFirst({ where: { id: dto.menteePersonId, deletedAt: null } }),
    ]);
    if (!mentor || !mentee) throw new BadRequestException('Mentor or mentee not found');
    const pair = await this.prisma.mentorshipPair.create({
      data: {
        mentorPersonId: dto.mentorPersonId,
        menteePersonId: dto.menteePersonId,
        status: dto.status ?? 'planned',
        focusArea: dto.focusArea ?? null,
        startDate: dto.startDate ? new Date(dto.startDate) : null,
        targetEndDate: dto.targetEndDate ? new Date(dto.targetEndDate) : null,
        progressNote: dto.progressNote ?? null,
      },
      include: {
        mentor: { select: { id: true, fullNameEn: true, fullNameAr: true, email: true } },
        mentee: { select: { id: true, fullNameEn: true, fullNameAr: true, email: true } },
      },
    });
    await this.audit.log({ actor, action: 'mentorship_pair.create', entityType: 'mentorship_pair', entityId: pair.id });
    return pair;
  }
}
