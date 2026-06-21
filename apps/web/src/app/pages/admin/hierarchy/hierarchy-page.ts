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

export interface HierarchyPageConfig {
  apiBase: string;
  titleKey: string;
  subtitleKey: string;
  addRootKey: string;
  newTitleKey: string;
  editTitleKey: string;
  /** Show the description field in the form (default true). */
  showDescription?: boolean;
}

interface Node {
  id: string;
  code: string;
  nameEn: string;
  nameAr: string;
  description?: string;
  parentId: string | null;
  isActive: boolean;
}

@Component({
  selector: 'app-hierarchy-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule, Modal, TreeView],
  templateUrl: './hierarchy-page.html',
  styleUrl: './hierarchy-page.scss',
})
export class HierarchyPage implements OnInit {
  readonly config = input.required<HierarchyPageConfig>();

  private readonly http = inject(HttpClient);
  protected readonly i18n = inject(I18nService);
  private readonly toast = inject(ToastService);
  private readonly confirm = inject(ConfirmService);

  protected readonly nodes = signal<Node[]>([]);
  protected readonly state = signal<'loading' | 'ok' | 'error'>('loading');
  protected readonly search = signal('');

  protected readonly modalOpen = signal(false);
  protected readonly editingId = signal<string | null>(null);
  protected readonly model = signal<Partial<Node>>({});
  protected readonly saving = signal(false);

  protected readonly rows = computed<TreeRow[]>(() => {
    const all = this.flatten(this.nodes());
    const term = this.search().trim().toLowerCase();
    if (!term) return all;
    return all.filter(
      (r) => r.label.toLowerCase().includes(term) || (r.sublabel ?? '').toLowerCase().includes(term),
    );
  });

  protected readonly parentOptions = computed<Node[]>(() => {
    const editing = this.editingId();
    if (!editing) return this.nodes();
    const blocked = this.descendants(editing);
    blocked.add(editing);
    return this.nodes().filter((n) => !blocked.has(n.id));
  });

  ngOnInit(): void {
    this.load();
  }

  protected load(): void {
    this.state.set('loading');
    this.http.get<Node[]>(this.config().apiBase).subscribe({
      next: (nodes) => {
        this.nodes.set(nodes);
        this.state.set('ok');
      },
      error: () => this.state.set('error'),
    });
  }

  private flatten(nodes: Node[]): TreeRow[] {
    const childrenOf = new Map<string | null, Node[]>();
    for (const n of nodes) {
      const key = n.parentId && nodes.some((p) => p.id === n.parentId) ? n.parentId : null;
      const arr = childrenOf.get(key) ?? [];
      arr.push(n);
      childrenOf.set(key, arr);
    }
    const rows: TreeRow[] = [];
    const walk = (parentId: string | null, depth: number) => {
      for (const n of childrenOf.get(parentId) ?? []) {
        rows.push({
          id: n.id,
          label: this.name(n),
          sublabel: n.code + (n.isActive ? '' : ' · ' + this.i18n.t('crud.inactive')),
          depth,
        });
        walk(n.id, depth + 1);
      }
    };
    walk(null, 0);
    return rows;
  }

  private descendants(id: string): Set<string> {
    const result = new Set<string>();
    const walk = (pid: string) => {
      for (const n of this.nodes()) {
        if (n.parentId === pid && !result.has(n.id)) {
          result.add(n.id);
          walk(n.id);
        }
      }
    };
    walk(id);
    return result;
  }

  protected name(n: { nameEn: string; nameAr: string }): string {
    return this.i18n.lang() === 'ar' ? n.nameAr : n.nameEn;
  }

  protected openCreate(parentId: string | null = null): void {
    this.model.set({ code: '', nameEn: '', nameAr: '', description: '', parentId, isActive: true });
    this.editingId.set(null);
    this.modalOpen.set(true);
  }

  protected openEditById(id: string): void {
    const n = this.nodes().find((x) => x.id === id);
    if (!n) return;
    this.model.set({ ...n });
    this.editingId.set(id);
    this.modalOpen.set(true);
  }

  protected setField(key: keyof Node, value: unknown): void {
    this.model.update((m) => ({ ...m, [key]: value }));
  }

  protected canSave(): boolean {
    const m = this.model();
    return !!(m.code && m.nameEn && m.nameAr);
  }

  protected save(): void {
    if (!this.canSave() || this.saving()) return;
    this.saving.set(true);
    const m = this.model();
    const body = {
      code: m.code,
      nameEn: m.nameEn,
      nameAr: m.nameAr,
      description: m.description || null,
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
      error: () => {
        this.toast.error(this.i18n.t('crud.saveError'));
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
      error: () => this.toast.error(this.i18n.t('crud.deleteError')),
    });
  }

  protected close(): void {
    this.modalOpen.set(false);
  }

  protected t(key: string): string {
    return this.i18n.t(key);
  }
}
