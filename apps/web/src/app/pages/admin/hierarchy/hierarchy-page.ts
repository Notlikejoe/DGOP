import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  input,
  OnInit,
  signal,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { HttpClient } from '@angular/common/http';
import { I18nService } from '../../../core/i18n.service';
import { ToastService } from '../../../shared/toast.service';
import { ConfirmService } from '../../../shared/confirm.service';
import { Modal } from '../../../shared/modal';
import { TreeView, TreeRow } from '../../../shared/tree-view';
import { AppIcon, AppIconName } from '../../../shared/app-icon';

export interface HierarchyPageConfig {
  apiBase: string;
  titleKey: string;
  subtitleKey: string;
  addRootKey: string;
  newTitleKey: string;
  editTitleKey: string;
  iconName?: AppIconName;
  /** Show the description field in the form (default true). */
  showDescription?: boolean;
}

interface HierarchyNode {
  id: string;
  code: string;
  nameEn: string;
  nameAr: string;
  description?: string;
  parentId: string | null;
  isActive: boolean;
}

interface Metric {
  labelKey: string;
  value: string | number;
  tone: 'accent' | 'success' | 'warning' | 'neutral';
}
const CODE_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{1,63}$/;

@Component({
  selector: 'app-hierarchy-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule, Modal, TreeView, AppIcon],
  templateUrl: './hierarchy-page.html',
  styleUrl: './hierarchy-page.scss',
})
export class HierarchyPage implements OnInit {
  readonly config = input.required<HierarchyPageConfig>();

  private readonly http = inject(HttpClient);
  protected readonly i18n = inject(I18nService);
  private readonly toast = inject(ToastService);
  private readonly confirm = inject(ConfirmService);

  protected readonly nodes = signal<HierarchyNode[]>([]);
  protected readonly state = signal<'loading' | 'ok' | 'error'>('loading');
  protected readonly search = signal('');
  protected readonly selectedId = signal<string | null>(null);

  protected readonly modalOpen = signal(false);
  protected readonly editingId = signal<string | null>(null);
  protected readonly model = signal<Partial<HierarchyNode>>({});
  protected readonly saving = signal(false);

  protected readonly childrenOf = computed(() => this.buildChildrenMap(this.nodes()));

  protected readonly rows = computed<TreeRow[]>(() => this.flatten(this.nodes(), this.search()));

  protected readonly selectedNode = computed(() => {
    const nodes = this.nodes();
    if (nodes.length === 0) return null;
    const selected = nodes.find((node) => node.id === this.selectedId());
    return selected ?? nodes[0];
  });

  protected readonly selectedNodeId = computed(() => this.selectedNode()?.id ?? null);

  protected readonly selectedChildren = computed(() => {
    const selected = this.selectedNode();
    if (!selected) return [];
    return this.childrenOf().get(selected.id) ?? [];
  });

  protected readonly selectedParentName = computed(() => {
    const selected = this.selectedNode();
    if (!selected?.parentId) return this.t('hierarchy.topLevel');
    const parent = this.nodes().find((node) => node.id === selected.parentId);
    return parent ? this.name(parent) : this.t('hierarchy.topLevel');
  });

  protected readonly selectedLevel = computed(() => {
    const selected = this.selectedNode();
    if (!selected) return 0;
    return this.depthOf(selected.id, this.nodes()) + 1;
  });

  protected readonly metrics = computed<Metric[]>(() => {
    const nodes = this.nodes();
    const inactive = nodes.filter((node) => !node.isActive).length;
    return [
      { labelKey: 'hierarchy.totalNodes', value: nodes.length, tone: 'accent' },
      { labelKey: 'hierarchy.topLevel', value: this.rootCount(nodes), tone: 'success' },
      { labelKey: 'hierarchy.maxDepth', value: this.maxDepth(nodes), tone: 'neutral' },
      {
        labelKey: 'hierarchy.needsReview',
        value: inactive,
        tone: inactive > 0 ? 'warning' : 'success',
      },
    ];
  });

  protected readonly visibleCount = computed(() => this.rows().length);
  protected readonly pageIcon = computed<AppIconName>(() => this.config().iconName ?? 'network');

  ngOnInit(): void {
    this.load();
  }

  protected load(): void {
    this.state.set('loading');
    this.http.get<HierarchyNode[]>(this.config().apiBase).subscribe({
      next: (nodes) => {
        this.nodes.set(nodes);
        this.ensureSelection(nodes);
        this.state.set('ok');
      },
      error: () => this.state.set('error'),
    });
  }

  private flatten(nodes: HierarchyNode[], searchTerm: string): TreeRow[] {
    const childrenOf = this.buildChildrenMap(nodes);
    const visibleIds = this.visibleNodeIds(nodes, searchTerm, childrenOf);
    const rows: TreeRow[] = [];
    const visited = new Set<string>();

    const walk = (parentId: string | null, depth: number) => {
      for (const node of childrenOf.get(parentId) ?? []) {
        if (visited.has(node.id)) continue;
        visited.add(node.id);
        if (!visibleIds || visibleIds.has(node.id)) {
          rows.push({
            id: node.id,
            label: this.name(node),
            sublabel: node.description || '',
            code: node.code,
            childCount: (childrenOf.get(node.id) ?? []).length,
            depth,
            isActive: node.isActive,
          });
        }
        walk(node.id, depth + 1);
      }
    };

    walk(null, 0);
    return rows;
  }

  private visibleNodeIds(
    nodes: HierarchyNode[],
    searchTerm: string,
    childrenOf: Map<string | null, HierarchyNode[]>,
  ): Set<string> | null {
    const term = searchTerm.trim().toLowerCase();
    if (!term) return null;

    const byId = new Map(nodes.map((node) => [node.id, node]));
    const visible = new Set<string>();

    const markAncestors = (node: HierarchyNode) => {
      let current: HierarchyNode | undefined = node;
      const seen = new Set<string>();
      while (current && !seen.has(current.id)) {
        seen.add(current.id);
        visible.add(current.id);
        current = current.parentId ? byId.get(current.parentId) : undefined;
      }
    };

    const markDescendants = (id: string, seen = new Set<string>()) => {
      if (seen.has(id)) return;
      seen.add(id);
      for (const child of childrenOf.get(id) ?? []) {
        visible.add(child.id);
        markDescendants(child.id, seen);
      }
    };

    for (const node of nodes) {
      if (this.matches(node, term)) {
        markAncestors(node);
        markDescendants(node.id);
      }
    }

    return visible;
  }

  private matches(node: HierarchyNode, term: string): boolean {
    return [this.name(node), node.code, node.description ?? '']
      .some((value) => value.toLowerCase().includes(term));
  }

  private buildChildrenMap(nodes: HierarchyNode[]): Map<string | null, HierarchyNode[]> {
    const ids = new Set(nodes.map((node) => node.id));
    const childrenOf = new Map<string | null, HierarchyNode[]>();
    for (const node of nodes) {
      const key = node.parentId && ids.has(node.parentId) ? node.parentId : null;
      const children = childrenOf.get(key) ?? [];
      children.push(node);
      childrenOf.set(key, children);
    }

    for (const children of childrenOf.values()) {
      children.sort((a, b) => this.name(a).localeCompare(this.name(b), this.i18n.lang()));
    }

    return childrenOf;
  }

  private descendants(id: string): Set<string> {
    const result = new Set<string>();
    const walk = (pid: string) => {
      for (const node of this.nodes()) {
        if (node.parentId === pid && !result.has(node.id)) {
          result.add(node.id);
          walk(node.id);
        }
      }
    };
    walk(id);
    return result;
  }

  private ensureSelection(nodes: HierarchyNode[]): void {
    const selected = this.selectedId();
    if (selected && nodes.some((node) => node.id === selected)) return;
    this.selectedId.set(this.firstRoot(nodes)?.id ?? nodes[0]?.id ?? null);
  }

  private firstRoot(nodes: HierarchyNode[]): HierarchyNode | null {
    const ids = new Set(nodes.map((node) => node.id));
    return nodes.find((node) => !node.parentId || !ids.has(node.parentId)) ?? null;
  }

  private rootCount(nodes: HierarchyNode[]): number {
    const ids = new Set(nodes.map((node) => node.id));
    return nodes.filter((node) => !node.parentId || !ids.has(node.parentId)).length;
  }

  private maxDepth(nodes: HierarchyNode[]): number {
    if (nodes.length === 0) return 0;
    return Math.max(...nodes.map((node) => this.depthOf(node.id, nodes) + 1));
  }

  private depthOf(id: string, nodes: HierarchyNode[]): number {
    const byId = new Map(nodes.map((node) => [node.id, node]));
    let depth = 0;
    let current = byId.get(id);
    const seen = new Set<string>();
    while (current?.parentId && byId.has(current.parentId) && !seen.has(current.id)) {
      seen.add(current.id);
      depth += 1;
      current = byId.get(current.parentId);
    }
    return depth;
  }

  protected readonly parentOptions = computed<HierarchyNode[]>(() => {
    const editing = this.editingId();
    if (!editing) return this.nodes();
    const blocked = this.descendants(editing);
    blocked.add(editing);
    return this.nodes().filter((node) => !blocked.has(node.id));
  });

  protected name(node: { nameEn: string; nameAr: string }): string {
    return this.i18n.lang() === 'ar' ? node.nameAr : node.nameEn;
  }

  protected selectNode(id: string): void {
    this.selectedId.set(id);
  }

  protected openCreate(parentId: string | null = null): void {
    this.model.set({ code: '', nameEn: '', nameAr: '', description: '', parentId, isActive: true });
    this.editingId.set(null);
    this.modalOpen.set(true);
  }

  protected openEditById(id: string): void {
    const node = this.nodes().find((item) => item.id === id);
    if (!node) return;
    this.model.set({ ...node });
    this.editingId.set(id);
    this.modalOpen.set(true);
  }

  protected setField(key: keyof HierarchyNode, value: unknown): void {
    this.model.update((m) => ({ ...m, [key]: value }));
  }

  protected canSave(): boolean {
    return this.validationErrors().length === 0;
  }

  protected save(): void {
    if (!this.canSave() || this.saving()) return;
    this.saving.set(true);
    const m = this.model();
    const body = {
      code: typeof m.code === 'string' ? m.code.trim() : m.code,
      nameEn: typeof m.nameEn === 'string' ? m.nameEn.trim() : m.nameEn,
      nameAr: typeof m.nameAr === 'string' ? m.nameAr.trim() : m.nameAr,
      description: typeof m.description === 'string' ? m.description.trim() || null : null,
      parentId: m.parentId || null,
      isActive: m.isActive ?? true,
    };
    const id = this.editingId();
    const req = id
      ? this.http.patch(`${this.config().apiBase}/${id}`, body)
      : this.http.post(this.config().apiBase, body);
    req.subscribe({
      next: () => {
        this.toast.success(this.i18n.t(id ? 'crud.updated' : 'crud.created'));
        this.saving.set(false);
        this.modalOpen.set(false);
        this.load();
      },
      error: (err) => { this.toast.errorFrom(err, this.i18n.t('crud.saveError'));
        this.saving.set(false);
      },
    });
  }

  protected async removeById(id: string): Promise<void> {
    const ok = await this.confirm.ask('crud.confirmDelete');
    if (!ok) return;
    this.http.delete(`${this.config().apiBase}/${id}`).subscribe({
      next: () => {
        this.toast.success(this.i18n.t('crud.deleted'));
        this.load();
      },
      error: (err) => this.toast.errorFrom(err, this.i18n.t('crud.deleteError')),
    });
  }

  protected close(): void {
    this.modalOpen.set(false);
  }

  protected validationErrors(): string[] {
    const errors: string[] = [];
    const m = this.model();
    const code = typeof m.code === 'string' ? m.code.trim() : '';
    const nameEn = typeof m.nameEn === 'string' ? m.nameEn.trim() : '';
    const nameAr = typeof m.nameAr === 'string' ? m.nameAr.trim() : '';
    const description = typeof m.description === 'string' ? m.description.trim() : '';
    const original = this.editingId() ? this.nodes().find((node) => node.id === this.editingId()) : null;

    if (!code) errors.push(this.t('validation.codeRequired'));
    else if (!CODE_PATTERN.test(code)) errors.push(this.t('validation.codeFormat'));
    if (code.length > 64) errors.push(this.t('validation.codeLength'));
    if (original && code !== original.code) errors.push(this.t('validation.codeImmutable'));
    if (!nameEn) errors.push(this.t('validation.nameEnRequired'));
    if (!nameAr) errors.push(this.t('validation.nameArRequired'));
    if (nameEn.length > 180 || nameAr.length > 180) errors.push(this.t('validation.nameLength'));
    if (description.length > 1000) errors.push(this.t('validation.descriptionLength'));
    if (this.editingId() && m.parentId === this.editingId()) errors.push(this.t('validation.parentSelf'));
    if (this.editingId() && typeof m.parentId === 'string' && this.descendants(this.editingId()!).has(m.parentId)) {
      errors.push(this.t('validation.parentDescendant'));
    }

    return [...new Set(errors)];
  }

  protected t(key: string): string {
    return this.i18n.t(key);
  }
}
