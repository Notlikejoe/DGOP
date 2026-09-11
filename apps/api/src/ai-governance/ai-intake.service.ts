import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { CaseStatus, Prisma } from '@prisma/client';
import { AuditService } from '../audit/audit.service';
import { PrismaService } from '../prisma/prisma.service';
import { canonicalAiReference } from '../master-data/ai-reference.catalog';
import { AiAuthorizationService } from './ai-authorization.service';
import { AI_INTAKE_SCHEMA_VERSION, AiIntakeDraftV1, AiIntakeField, AiIntakeV1 } from './ai-governance.contracts';
import { AiIdentifiersService } from './ai-identifiers.service';
import {
  AI_INTAKE_REFERENCE_FIELDS,
  AiIntakeValidationIssue,
  assertAiIntakeDraftPayload,
  assertAiIntakeSubmission,
} from './ai-intake.validation';

type IntakeClient = PrismaService | Prisma.TransactionClient;
type IntakeWarning = { field: AiIntakeField; code: string; message: string };
type ReferenceSelection = { code: string; labelEn: string; labelAr: string };

const intakeRevision = {
  id: true,
  revision: true,
  schemaVersion: true,
  payload: true,
  submittedAt: true,
  createdBy: true,
  createdAt: true,
} satisfies Prisma.AiIntakeRevisionSelect;

const intakeUseCase = {
  id: true,
  useCaseRef: true,
  workflowCaseId: true,
  requesterUserId: true,
  ownerPersonId: true,
  organizationUnitId: true,
  name: true,
  description: true,
  version: true,
  createdAt: true,
  updatedAt: true,
  workflowCase: { select: { id: true, code: true, status: true, type: true } },
  intakeRevisions: { orderBy: { revision: 'desc' as const }, take: 1, select: intakeRevision },
} satisfies Prisma.AiUseCaseSelect;

function dateInRiyadh(at: Date): string {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Riyadh', year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(at);
  const part = (type: Intl.DateTimeFormatPartTypes) => parts.find(item => item.type === type)?.value ?? '';
  return `${part('year')}-${part('month')}-${part('day')}`;
}

function yearInRiyadh(at: Date): number {
  return Number(dateInRiyadh(at).slice(0, 4));
}

function asJson(payload: AiIntakeDraftV1): Prisma.InputJsonObject {
  return payload as unknown as Prisma.InputJsonObject;
}

function cleanArabic(value: string): string {
  return value.replace(/[\u200e\u200f\u202a-\u202e\u2066-\u2069]/gu, '').trim();
}

@Injectable()
export class AiIntakeService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly authorization: AiAuthorizationService,
    private readonly identifiers: AiIdentifiersService,
    private readonly audit: AuditService,
  ) {}

  private badRequest(error: unknown): never {
    const value = error as { message?: string; issues?: AiIntakeValidationIssue[] };
    throw new BadRequestException({
      message: value.message ?? 'AI intake validation failed',
      issues: value.issues ?? [],
    });
  }

  private assertDraft(payload: unknown): asserts payload is AiIntakeDraftV1 {
    try {
      assertAiIntakeDraftPayload(payload);
    } catch (error) {
      this.badRequest(error);
    }
  }

  private assertSubmission(payload: unknown, today: string): asserts payload is AiIntakeV1 {
    try {
      assertAiIntakeSubmission(payload, today);
    } catch (error) {
      this.badRequest(error);
    }
  }

  private async currentReferences(client: IntakeClient, payload: AiIntakeDraftV1, at: Date) {
    const issues: AiIntakeValidationIssue[] = [];
    const versionPins: Record<string, string> = {};
    const selected: Partial<Record<AiIntakeField, ReferenceSelection[]>> = {};
    for (const [field, alias] of Object.entries(AI_INTAKE_REFERENCE_FIELDS) as [AiIntakeField, string][]) {
      const raw = payload[field];
      if (raw === undefined || raw === '' || (Array.isArray(raw) && raw.length === 0)) continue;
      const listCode = canonicalAiReference(alias);
      const version = await client.governedReferenceVersion.findFirst({
        where: {
          listCode,
          state: 'published',
          effectiveFrom: { lte: at },
          OR: [{ effectiveTo: null }, { effectiveTo: { gt: at } }],
        },
        orderBy: { version: 'desc' },
        include: { values: true },
      });
      if (!version) {
        issues.push({ field, code: 'REFERENCE_LIST_UNAVAILABLE', message: `Published reference list ${listCode} is required` });
        continue;
      }
      versionPins[listCode] = version.id;
      const requested = Array.isArray(raw) ? raw : [raw];
      const byCode = new Map(version.values.map(value => [value.code, value]));
      const missing = requested.filter(code => typeof code !== 'string' || !byCode.has(code));
      if (missing.length) {
        issues.push({ field, code: 'INVALID_REFERENCE_VALUE', message: `${field} contains a value outside published ${listCode}` });
        continue;
      }
      selected[field] = requested.map(code => {
        const value = byCode.get(String(code))!;
        return { code: value.code, labelEn: value.labelEn, labelAr: value.labelAr };
      });
    }
    if (issues.length) throw new BadRequestException({ message: 'Governed reference validation failed', issues });
    return { versionPins, selected };
  }

  private async directoryReferences(client: IntakeClient, actorId: string, payload: AiIntakeDraftV1) {
    const fields = ['requester', 'proposed_owner', 'data_owner', 'executive_sponsor'] as const;
    const ids = fields.map(field => payload[field]).filter((id): id is string => typeof id === 'string' && !!id);
    const users = ids.length ? await client.user.findMany({
      where: { id: { in: [...new Set(ids)] }, isActive: true },
      select: {
        id: true,
        person: { select: { id: true, isActive: true, deletedAt: true } },
        userRoles: { where: { role: { isActive: true, deletedAt: null } }, select: { role: { select: { code: true } } } },
      },
    }) : [];
    const byId = new Map(users.map(user => [user.id, user]));
    const issues: AiIntakeValidationIssue[] = [];
    const warnings: IntakeWarning[] = [];
    for (const field of fields) {
      const id = payload[field];
      if (!id) continue;
      const user = byId.get(id);
      if (!user) {
        issues.push({ field, code: 'DIRECTORY_USER_REQUIRED', message: `${field} must reference an active organization-directory user` });
      }
    }
    if (payload.requester && payload.requester !== actorId) {
      issues.push({ field: 'requester', code: 'REQUESTER_MISMATCH', message: 'Requester must match the authenticated submitter' });
    }
    const owner = payload.proposed_owner ? byId.get(payload.proposed_owner) : undefined;
    if (owner) {
      if (!owner.person || !owner.person.isActive || owner.person.deletedAt) {
        issues.push({ field: 'proposed_owner', code: 'OWNER_DIRECTORY_PROFILE_REQUIRED', message: 'Proposed owner must have an active person-directory profile' });
      } else if (!owner.userRoles.some(row => row.role.code === 'AI_USECASE_OWNER')) {
        issues.push({ field: 'proposed_owner', code: 'OWNER_ROLE_REQUIRED', message: 'Proposed owner must hold the AI_USECASE_OWNER role' });
      }
    }
    const dataOwner = payload.data_owner ? byId.get(payload.data_owner) : undefined;
    if (dataOwner && !dataOwner.userRoles.some(row => row.role.code === 'data_owner')) {
      warnings.push({ field: 'data_owner', code: 'DATA_OWNER_ROLE_WARNING', message: 'The selected data owner does not currently hold the DATA_OWNER role' });
    }
    if (issues.length) throw new BadRequestException({ message: 'Organization-directory validation failed', issues });
    return { ownerPersonId: owner?.person?.id ?? null, warnings };
  }

  private async duplicateWarning(client: IntakeClient, payload: AiIntakeDraftV1, excludeId?: string): Promise<IntakeWarning[]> {
    const name = payload.usecase_name?.trim();
    if (!name) return [];
    const duplicate = await client.aiUseCase.findFirst({
      where: { id: excludeId ? { not: excludeId } : undefined, deletedAt: null, name: { equals: name, mode: 'insensitive' } },
      select: { id: true },
    });
    return duplicate ? [{ field: 'usecase_name', code: 'DUPLICATE_NAME_WARNING', message: 'An active AI use case already uses this name' }] : [];
  }

  private businessWarnings(
    payload: AiIntakeDraftV1,
    selected: Partial<Record<AiIntakeField, ReferenceSelection[]>>,
  ): IntakeWarning[] {
    const warnings: IntakeWarning[] = [];
    if (payload.simpler_alternatives?.answer === false) {
      warnings.push({ field: 'simpler_alternatives', code: 'SIMPLER_ALTERNATIVE_NOT_CONFIRMED', message: 'Triage review is required because simpler alternatives were not confirmed' });
    }
    if (payload.existing_solutions_check?.answer === false) {
      warnings.push({ field: 'existing_solutions_check', code: 'EXISTING_SOLUTION_NOT_CONFIRMED', message: 'Triage review is required because existing HRDF solutions were not confirmed' });
    }
    const classification = selected.data_classification?.[0];
    if (classification && cleanArabic(classification.labelAr) === 'غير معروف') {
      warnings.push({ field: 'data_classification', code: 'UNKNOWN_CLASSIFICATION_WARNING', message: 'Data classification must be confirmed before decision' });
    }
    return warnings;
  }

  private conditions(selected: Partial<Record<AiIntakeField, ReferenceSelection[]>>) {
    return {
      personalDataInvolved: cleanArabic(selected.personal_data_flag?.[0]?.labelAr ?? '') === 'نعم',
      sensitiveDataInvolved: cleanArabic(selected.data_classification?.[0]?.labelAr ?? '') === 'سرية',
    };
  }

  async createDraft(userId: string, supplied: Record<string, unknown>) {
    return this.prisma.$transaction(async tx => {
      await this.authorization.authorize(userId, 'case.create.aiuc', tx);
      const now = new Date();
      const payload: unknown = { request_date: dateInRiyadh(now), requester: userId, ...supplied };
      this.assertDraft(payload);
      const references = await this.currentReferences(tx, payload, now);
      const directory = await this.directoryReferences(tx, userId, payload);
      const duplicates = await this.duplicateWarning(tx, payload);
      const warnings = [...directory.warnings, ...duplicates, ...this.businessWarnings(payload, references.selected)];
      const created = await tx.aiUseCase.create({
        data: {
          requesterUserId: userId,
          ownerPersonId: directory.ownerPersonId,
          name: payload.usecase_name?.trim() || 'AI use-case draft',
          description: payload.problem_desc?.trim() || null,
          createdBy: userId,
          intakeRevisions: { create: { revision: 1, schemaVersion: AI_INTAKE_SCHEMA_VERSION, payload: asJson(payload), createdBy: userId } },
        },
        select: intakeUseCase,
      });
      await this.audit.logRequired({
        actor: userId,
        action: 'aiuc.intake.draft.created',
        entityType: 'ai_use_case',
        entityId: created.id,
        metadata: { revision: 1, referenceVersions: references.versionPins },
      }, tx);
      return { ...created, warnings, conditions: this.conditions(references.selected) };
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  }

  async updateDraft(userId: string, id: string, expectedVersion: number, changes: Record<string, unknown>) {
    return this.prisma.$transaction(async tx => {
      await this.authorization.authorize(userId, 'case.create.aiuc', tx);
      const current = await tx.aiUseCase.findFirst({ where: { id, deletedAt: null }, select: intakeUseCase });
      if (!current) throw new NotFoundException('AI use-case draft not found');
      if (current.requesterUserId !== userId) throw new ForbiddenException('Only the requester can edit this AI intake draft');
      if (current.workflowCaseId || current.intakeRevisions[0]?.submittedAt) {
        throw new ConflictException('Submitted AI intake fields are read-only');
      }
      if (current.version !== expectedVersion) throw new ConflictException('AI use-case draft changed; reload before saving');
      const prior = current.intakeRevisions[0]?.payload ?? {};
      const payload = { ...(prior as Record<string, unknown>), ...changes };
      this.assertDraft(payload);
      const now = new Date();
      const references = await this.currentReferences(tx, payload, now);
      const directory = await this.directoryReferences(tx, userId, payload);
      const duplicates = await this.duplicateWarning(tx, payload, id);
      const updated = await tx.aiUseCase.updateMany({
        where: { id, version: expectedVersion, workflowCaseId: null },
        data: {
          ownerPersonId: directory.ownerPersonId,
          name: payload.usecase_name?.trim() || current.name,
          description: payload.problem_desc?.trim() || null,
          version: { increment: 1 },
        },
      });
      if (updated.count !== 1) throw new ConflictException('AI use-case draft changed; reload before saving');
      const revision = (current.intakeRevisions[0]?.revision ?? 0) + 1;
      await tx.aiIntakeRevision.create({ data: { useCaseId: id, revision, schemaVersion: AI_INTAKE_SCHEMA_VERSION, payload: asJson(payload), createdBy: userId } });
      await this.audit.logRequired({
        actor: userId,
        action: 'aiuc.intake.draft.revised',
        entityType: 'ai_use_case',
        entityId: id,
        metadata: { revision, expectedVersion, changedFields: Object.keys(changes).sort(), referenceVersions: references.versionPins },
      }, tx);
      const saved = await tx.aiUseCase.findUniqueOrThrow({ where: { id }, select: intakeUseCase });
      return {
        ...saved,
        warnings: [...directory.warnings, ...duplicates, ...this.businessWarnings(payload, references.selected)],
        conditions: this.conditions(references.selected),
      };
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  }

  async submit(userId: string, id: string, expectedVersion: number) {
    return this.prisma.$transaction(async tx => {
      await this.authorization.authorize(userId, 'case.create.aiuc', tx);
      const current = await tx.aiUseCase.findFirst({ where: { id, deletedAt: null }, select: intakeUseCase });
      if (!current) throw new NotFoundException('AI use-case draft not found');
      if (current.requesterUserId !== userId) throw new ForbiddenException('Only the requester can submit this AI intake');
      if (current.workflowCaseId || current.intakeRevisions[0]?.submittedAt) throw new ConflictException('AI intake is already submitted');
      if (current.version !== expectedVersion) throw new ConflictException('AI use-case draft changed; reload before submitting');
      const payload = current.intakeRevisions[0]?.payload ?? {};
      const now = new Date();
      this.assertSubmission(payload, dateInRiyadh(now));
      const references = await this.currentReferences(tx, payload, now);
      const directory = await this.directoryReferences(tx, userId, payload);
      const caseCode = await this.identifiers.nextCaseCode(tx, 'AIUC', yearInRiyadh(now));
      const workflowCase = await tx.workflowCase.create({
        data: {
          code: caseCode,
          title: payload.usecase_name.trim(),
          description: payload.problem_desc.trim(),
          type: 'AIUC',
          status: CaseStatus.submitted,
          createdBy: userId,
        },
        select: { id: true, code: true, status: true, type: true },
      });
      await tx.workflowEvent.create({
        data: { caseId: workflowCase.id, actor: userId, action: 'aiuc.intake.submitted', toStatus: CaseStatus.submitted },
      });
      const revision = (current.intakeRevisions[0]?.revision ?? 0) + 1;
      await tx.aiIntakeRevision.create({
        data: {
          useCaseId: id,
          revision,
          schemaVersion: AI_INTAKE_SCHEMA_VERSION,
          payload: asJson(payload),
          submittedAt: now,
          createdBy: userId,
        },
      });
      const updated = await tx.aiUseCase.updateMany({
        where: { id, version: expectedVersion, workflowCaseId: null },
        data: {
          workflowCaseId: workflowCase.id,
          ownerPersonId: directory.ownerPersonId,
          name: payload.usecase_name.trim(),
          description: payload.problem_desc.trim(),
          version: { increment: 1 },
        },
      });
      if (updated.count !== 1) throw new ConflictException('AI use-case draft changed; reload before submitting');
      const conditions = this.conditions(references.selected);
      const duplicateWarnings = await this.duplicateWarning(tx, payload, id);
      const warnings = [...directory.warnings, ...duplicateWarnings, ...this.businessWarnings(payload, references.selected)];
      await this.audit.logRequired({
        actor: userId,
        action: 'aiuc.intake.submitted',
        entityType: 'ai_use_case',
        entityId: id,
        metadata: {
          caseCode,
          revision,
          referenceVersions: references.versionPins,
          conditions,
          warnings: warnings.map(warning => warning.code),
        },
      }, tx);
      const saved = await tx.aiUseCase.findUniqueOrThrow({ where: { id }, select: intakeUseCase });
      return { ...saved, warnings, conditions };
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  }

  async listOwn(userId: string) {
    await this.authorization.authorize(userId, 'case.view.aiuc.own');
    return this.prisma.aiUseCase.findMany({
      where: { requesterUserId: userId, deletedAt: null },
      orderBy: { updatedAt: 'desc' },
      take: 100,
      select: intakeUseCase,
    });
  }

  async getOwn(userId: string, id: string) {
    await this.authorization.authorize(userId, 'case.view.aiuc.own');
    const result = await this.prisma.aiUseCase.findFirst({
      where: { id, requesterUserId: userId, deletedAt: null },
      select: intakeUseCase,
    });
    if (!result) throw new NotFoundException('AI use case not found');
    return result;
  }
}
