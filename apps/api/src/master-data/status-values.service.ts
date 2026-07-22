import { BadRequestException, Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { BaseCrudService } from './base-crud.service';

@Injectable()
export class StatusValuesService extends BaseCrudService {
  constructor(prisma: PrismaService, audit: AuditService) {
    super(prisma, audit, {
      model: 'statusValue',
      entityType: 'status_value',
      orderBy: [{ domain: 'asc' }, { sortOrder: 'asc' }],
      uniqueCode: false,
    });
  }

  protected override async prepareCreate(data: any): Promise<any> {
    const prepared = await super.prepareCreate(data);
    await this.assertUniqueDomainCode(prepared.domain, prepared.code);
    return prepared;
  }

  protected override async prepareUpdate(id: string, data: any, current: any): Promise<any> {
    const prepared = await super.prepareUpdate(id, data, current);
    if (
      Object.prototype.hasOwnProperty.call(prepared, 'domain') &&
      prepared.domain !== current.domain
    ) {
      throw new BadRequestException('status_value domain is immutable after creation');
    }
    if (
      Object.prototype.hasOwnProperty.call(prepared, 'code') &&
      prepared.code !== current.code
    ) {
      throw new BadRequestException('status_value code is immutable after creation');
    }
    if (prepared.domain || prepared.code) {
      await this.assertUniqueDomainCode(prepared.domain ?? current.domain, prepared.code ?? current.code, id);
    }
    return prepared;
  }

  private async assertUniqueDomainCode(domain: unknown, code: unknown, exceptId?: string): Promise<void> {
    if (typeof domain !== 'string' || typeof code !== 'string') return;
    const duplicate = await this.prisma.statusValue.findFirst({
      where: {
        domain,
        code,
        deletedAt: null,
        ...(exceptId ? { NOT: { id: exceptId } } : {}),
      },
      select: { id: true },
    });
    if (duplicate) throw new BadRequestException('status_value domain/code already exists');
  }
}
