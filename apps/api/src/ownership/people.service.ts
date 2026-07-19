import { BadRequestException, Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { BaseCrudService } from '../master-data/base-crud.service';
import { boundedFirstPageParams, parsePageParams, toPaged, type Paged } from '../common/pagination';

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
    });
  }

  /** Empty email/userId strings are stored as null so the unique constraints behave. */
  private normalize<T extends { email?: string | null; userId?: string | null }>(data: T): T {
    const out: any = { ...data };
    out.email = data.email ? data.email : null;
    if ('userId' in data) out.userId = data.userId ? data.userId : null;
    return out;
  }

  /** Enforces the 1:1 Person<->User link: a user account can back at most one person. */
  private async assertUserFree(userId: string | null, exceptPersonId?: string): Promise<void> {
    if (!userId) return;
    const user = await this.prisma.user.findFirst({ where: { id: userId } });
    if (!user) throw new BadRequestException('Linked user account not found');
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

  override async create(data: any, actor: string) {
    const norm = this.normalize(data);
    await this.assertUserFree(norm.userId ?? null);
    return super.create(norm, actor);
  }

  override async update(id: string, data: any, actor: string) {
    const norm = this.normalize(data);
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
