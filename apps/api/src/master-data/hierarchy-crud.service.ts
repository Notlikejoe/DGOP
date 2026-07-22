import { BadRequestException, Injectable } from '@nestjs/common';
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

  protected override async prepareCreate(data: any): Promise<any> {
    const prepared = await super.prepareCreate(data);
    if (prepared.parentId) await this.assertActiveParent(prepared.parentId);
    return prepared;
  }

  protected override async prepareUpdate(id: string, data: any, current: any): Promise<any> {
    const prepared = await super.prepareUpdate(id, data, current);
    if (Object.prototype.hasOwnProperty.call(prepared, 'parentId')) {
      await this.assertValidParentMove(id, prepared.parentId ?? null);
    }
    return prepared;
  }

  private async assertActiveParent(parentId: string): Promise<void> {
    const parent = await this.delegate.findFirst({
      where: { id: parentId, deletedAt: null, isActive: true },
      select: { id: true },
    });
    if (!parent) throw new BadRequestException('Parent must be an active record in the same hierarchy');
  }

  private async assertValidParentMove(id: string, parentId: string | null): Promise<void> {
    if (!parentId) return;
    if (parentId === id) throw new BadRequestException('A hierarchy node cannot be its own parent');
    await this.assertActiveParent(parentId);
    const descendants = await this.descendantIds(id);
    if (descendants.has(parentId)) {
      throw new BadRequestException('A hierarchy node cannot be moved under one of its descendants');
    }
  }

  private async descendantIds(id: string): Promise<Set<string>> {
    const rows: Pick<TreeNode, 'id' | 'parentId'>[] = await this.delegate.findMany({
      where: { deletedAt: null },
      select: { id: true, parentId: true },
    });
    const children = new Map<string, string[]>();
    for (const row of rows) {
      if (!row.parentId) continue;
      const list = children.get(row.parentId) ?? [];
      list.push(row.id);
      children.set(row.parentId, list);
    }
    const result = new Set<string>();
    const walk = (parent: string) => {
      for (const child of children.get(parent) ?? []) {
        if (result.has(child)) continue;
        result.add(child);
        walk(child);
      }
    };
    walk(id);
    return result;
  }
}
