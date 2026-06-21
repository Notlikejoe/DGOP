import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { BaseCrudService } from './base-crud.service';

interface OrgNode {
  id: string;
  code: string;
  nameEn: string;
  nameAr: string;
  parentId: string | null;
  isActive: boolean;
  children: OrgNode[];
}

@Injectable()
export class OrganizationUnitsService extends BaseCrudService {
  constructor(prisma: PrismaService, audit: AuditService) {
    super(prisma, audit, {
      model: 'organizationUnit',
      entityType: 'organization_unit',
      orderBy: { nameEn: 'asc' },
    });
  }

  async tree(): Promise<OrgNode[]> {
    const rows: OrgNode[] = await this.delegate.findMany({
      where: { deletedAt: null },
      orderBy: { nameEn: 'asc' },
    });
    const byId = new Map<string, OrgNode>();
    rows.forEach((r) => byId.set(r.id, { ...r, children: [] }));
    const roots: OrgNode[] = [];
    byId.forEach((node) => {
      if (node.parentId && byId.has(node.parentId)) {
        byId.get(node.parentId)!.children.push(node);
      } else {
        roots.push(node);
      }
    });
    return roots;
  }
}
