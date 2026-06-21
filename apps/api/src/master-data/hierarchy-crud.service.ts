import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { BaseCrudService, CrudOptions } from './base-crud.service';

interface TreeNode {
  id: string;
  code: string;
  nameEn: string;
  nameAr: string;
  parentId: string | null;
  isActive: boolean;
  children: TreeNode[];
}

/** Soft-delete CRUD plus a nested tree() builder for self-referencing entities. */
@Injectable()
export class HierarchyCrudService extends BaseCrudService {
  constructor(prisma: PrismaService, audit: AuditService, opts: CrudOptions) {
    super(prisma, audit, opts);
  }

  async tree(): Promise<TreeNode[]> {
    const rows: TreeNode[] = await this.delegate.findMany({
      where: { deletedAt: null },
      orderBy: { nameEn: 'asc' },
    });
    const byId = new Map<string, TreeNode>();
    rows.forEach((r) => byId.set(r.id, { ...r, children: [] }));
    const roots: TreeNode[] = [];
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
