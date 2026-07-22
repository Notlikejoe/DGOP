import { BadRequestException, Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { BaseCrudService } from '../master-data/base-crud.service';
import { boundedFirstPageParams, parsePageParams, toPaged, type Paged } from '../common/pagination';
import { trimRecord } from '../master-data/master-data.logic';

const userInclude = {
  user: { select: { id: true, email: true, displayName: true, isActive: true } },
};

@Injectable()
export class PeopleService extends BaseCrudService {
  constructor(prisma: PrismaService, audit: AuditService) {
    super(prisma, audit, {
      model: 'person',
      entityType: 'person',
      orderBy: { fullNameEn: 'asc' },
      include: userInclude,
      validation: 'none',
      deleteDependencies: [
        { model: 'stewardshipAssignment', field: 'personId', label: 'ownership assignments', where: { deletedAt: null } },
        { model: 'assignmentRule', field: 'personId', label: 'assignment rules', where: { deletedAt: null } },
        { model: 'certificationAttempt', field: 'personId', label: 'certification attempts' },
        { model: 'trainingAssignment', field: 'personId', label: 'training assignments' },
      ],
    });
  }

  /** Empty email/userId strings are stored as null so the unique constraints behave. */
  private normalize<T extends { email?: string | null; userId?: string | null }>(data: T): T {
    const out: any = trimRecord({ ...data });
    out.email = out.email ? String(out.email).toLowerCase() : null;
    if ('userId' in out) out.userId = out.userId ? out.userId : null;
    if ('jobTitle' in out) out.jobTitle = out.jobTitle ? out.jobTitle : null;
    if ('organization' in out) out.organization = out.organization ? out.organization : null;
    return out;
  }

  private assertPersonText(data: Record<string, unknown>, requireNames: boolean): void {
    const errors: string[] = [];
    for (const [key, label] of [
      ['fullNameEn', 'English full name'],
      ['fullNameAr', 'Arabic full name'],
    ] as const) {
      if (!(key in data)) {
        if (requireNames) errors.push(`${label} is required`);
        continue;
      }
      const value = data[key];
      if (typeof value !== 'string') {
        errors.push(`${label} must be text`);
      } else if (!value.trim()) {
        errors.push(`${label} is required`);
      } else if (value.trim().length > 180) {
        errors.push(`${label} must be 180 characters or fewer`);
      }
    }
    for (const key of ['email', 'jobTitle', 'organization']) {
      const value = data[key];
      if (value !== null && value !== undefined && typeof value === 'string' && value.length > 160) {
        errors.push(`${key} must be 160 characters or fewer`);
      }
    }
    if (errors.length) throw new BadRequestException(errors.join('; '));
  }

  /** Enforces the 1:1 Person<->User link: a user account can back at most one person. */
  private async assertUserFree(userId: string | null, exceptPersonId?: string): Promise<void> {
    if (!userId) return;
    const user = await this.prisma.user.findFirst({ where: { id: userId } });
    if (!user) throw new BadRequestException('Linked user account not found');
    if (!user.isActive) throw new BadRequestException('Linked user account must be active');
    const other = await this.prisma.person.findFirst({
      where: {
        userId,
        deletedAt: null,
        ...(exceptPersonId ? { NOT: { id: exceptPersonId } } : {}),
      },
    });
    if (other) {
      throw new BadRequestException('That user account is already linked to another person');
    }
  }

  private async assertEmailFree(email: string | null, exceptPersonId?: string): Promise<void> {
    if (!email) return;
    const other = await this.prisma.person.findFirst({
      where: {
        email,
        deletedAt: null,
        ...(exceptPersonId ? { NOT: { id: exceptPersonId } } : {}),
      },
      select: { id: true },
    });
    if (other) throw new BadRequestException('That email is already used by another person');
  }

  override async create(data: any, actor: string) {
    const norm = this.normalize(data);
    this.assertPersonText(norm, true);
    await this.assertEmailFree(norm.email ?? null);
    await this.assertUserFree(norm.userId ?? null);
    return super.create(norm, actor);
  }

  override async update(id: string, data: any, actor: string) {
    const norm = this.normalize(data);
    this.assertPersonText(norm, false);
    if ('email' in norm) await this.assertEmailFree(norm.email ?? null, id);
    if ('userId' in norm) await this.assertUserFree(norm.userId ?? null, id);
    return super.update(id, norm, actor);
  }

  /** Optionally paginated list. Returns a plain array unless `page` is supplied. */
  async listPaged(
    search?: string,
    page?: string | number,
    pageSize?: string | number,
  ): Promise<unknown[] | Paged<unknown>> {
    const term = (search ?? '').trim();
    const where: Record<string, unknown> = { deletedAt: null };
    if (term) {
      where.OR = [
        { fullNameEn: { contains: term, mode: 'insensitive' } },
        { fullNameAr: { contains: term, mode: 'insensitive' } },
        { email: { contains: term, mode: 'insensitive' } },
        { jobTitle: { contains: term, mode: 'insensitive' } },
      ];
    }
    const params = parsePageParams(page, pageSize);
    if (!params) {
      const bounded = boundedFirstPageParams(pageSize);
      return this.prisma.person.findMany({
        where,
        include: userInclude,
        orderBy: { fullNameEn: 'asc' },
        skip: bounded.skip,
        take: bounded.take,
      });
    }
    const [rows, total] = await Promise.all([
      this.prisma.person.findMany({
        where,
        include: userInclude,
        orderBy: { fullNameEn: 'asc' },
        skip: params.skip,
        take: params.take,
      }),
      this.prisma.person.count({ where }),
    ]);
    return toPaged(rows, total, params);
  }

  /** Resolves the governance person linked to a login account (for "my tasks" / self-service). */
  findByUserId(userId: string) {
    return this.prisma.person.findFirst({
      where: { userId, deletedAt: null },
      include: userInclude,
    });
  }
}
