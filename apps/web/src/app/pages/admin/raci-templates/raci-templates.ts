import { ChangeDetectionStrategy, Component, computed, inject, OnInit, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { HttpClient } from '@angular/common/http';
import { I18nService } from '../../../core/i18n.service';
import { ToastService } from '../../../shared/toast.service';
import { ConfirmService } from '../../../shared/confirm.service';
import { Modal } from '../../../shared/modal';
import { StatusChip } from '../../../shared/status-chip';

type Responsibility = 'R' | 'A' | 'C' | 'I';

interface RoleType {
  id: string;
  code: string;
  nameEn: string;
  nameAr: string;
}

interface RaciItem {
  roleTypeId: string;
  responsibility: Responsibility;
  roleType?: RoleType;
}

interface RaciTemplate {
  id: string;
  code: string;
  nameEn: string;
  nameAr: string;
  description?: string;
  processType?: string;
  isActive: boolean;
  items: RaciItem[];
}

interface Draft {
  code: string;
  nameEn: string;
  nameAr: string;
  description: string;
  processType: string;
  isActive: boolean;
  items: RaciItem[];
}
const CODE_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{1,63}$/;

@Component({
  selector: 'app-admin-raci-templates',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule, Modal, StatusChip],
  templateUrl: './raci-templates.html',
  styleUrl: './raci-templates.scss',
})
export class RaciTemplatesPage implements OnInit {
  private readonly http = inject(HttpClient);
  protected readonly i18n = inject(I18nService);
  private readonly toast = inject(ToastService);
  private readonly confirm = inject(ConfirmService);

  protected readonly templates = signal<RaciTemplate[]>([]);
  protected readonly roleTypes = signal<RoleType[]>([]);
  protected readonly state = signal<'loading' | 'ok' | 'error'>('loading');
  protected readonly search = signal('');

  protected readonly filtered = computed<RaciTemplate[]>(() => {
    const term = this.search().trim().toLowerCase();
    if (!term) return this.templates();
    return this.templates().filter((t) =>
      [t.code, t.nameEn, t.nameAr, t.processType ?? '']
        .join(' ')
        .toLowerCase()
        .includes(term),
    );
  });

  protected readonly modalOpen = signal(false);
  protected readonly editingId = signal<string | null>(null);
  protected readonly draft = signal<Draft>(this.emptyDraft());
  protected readonly saving = signal(false);

  protected readonly responsibilities: Responsibility[] = ['R', 'A', 'C', 'I'];

  ngOnInit(): void {
    this.load();
    this.http.get<RoleType[]>('/api/role-types').subscribe((r) => this.roleTypes.set(r));
  }

  private emptyDraft(): Draft {
    return { code: '', nameEn: '', nameAr: '', description: '', processType: '', isActive: true, items: [] };
  }

  protected load(): void {
    this.state.set('loading');
    this.http.get<RaciTemplate[]>('/api/raci-templates').subscribe({
      next: (t) => {
        this.templates.set(t);
        this.state.set('ok');
      },
      error: () => this.state.set('error'),
    });
  }

  protected name(o: { nameEn: string; nameAr: string }): string {
    return this.i18n.lang() === 'ar' ? o.nameAr : o.nameEn;
  }

  protected roleName(id: string): string {
    const rt = this.roleTypes().find((r) => r.id === id);
    return rt ? this.name(rt) : id;
  }

  protected set<K extends keyof Draft>(key: K, value: Draft[K]): void {
    this.draft.update((d) => ({ ...d, [key]: value }));
  }

  protected openCreate(): void {
    this.draft.set(this.emptyDraft());
    this.editingId.set(null);
    this.modalOpen.set(true);
  }

  protected openEdit(t: RaciTemplate): void {
    this.draft.set({
      code: t.code,
      nameEn: t.nameEn,
      nameAr: t.nameAr,
      description: t.description ?? '',
      processType: t.processType ?? '',
      isActive: t.isActive,
      items: t.items.map((i) => ({ roleTypeId: i.roleTypeId, responsibility: i.responsibility })),
    });
    this.editingId.set(t.id);
    this.modalOpen.set(true);
  }

  protected addItem(): void {
    const firstRole = this.roleTypes()[0];
    if (!firstRole) return;
    this.draft.update((d) => ({
      ...d,
      items: [...d.items, { roleTypeId: firstRole.id, responsibility: 'R' }],
    }));
  }

  protected updateItem(index: number, key: keyof RaciItem, value: string): void {
    this.draft.update((d) => {
      const items = d.items.slice();
      items[index] = { ...items[index], [key]: value };
      return { ...d, items };
    });
  }

  protected removeItem(index: number): void {
    this.draft.update((d) => ({ ...d, items: d.items.filter((_, i) => i !== index) }));
  }

  protected canSave(): boolean {
    return this.validationErrors().length === 0;
  }

  protected save(): void {
    if (!this.canSave() || this.saving()) return;
    this.saving.set(true);
    const d = this.draft();
    const body = {
      code: d.code.trim(),
      nameEn: d.nameEn.trim(),
      nameAr: d.nameAr.trim(),
      description: d.description.trim() || null,
      processType: d.processType.trim() || null,
      isActive: d.isActive,
      items: d.items.map((i) => ({ roleTypeId: i.roleTypeId, responsibility: i.responsibility })),
    };
    const id = this.editingId();
    const req = id
      ? this.http.patch('/api/raci-templates/' + id, body)
      : this.http.post('/api/raci-templates', body);
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

  protected async deleteTemplate(t: RaciTemplate): Promise<void> {
    const ok = await this.confirm.ask('crud.confirmDelete');
    if (!ok) return;
    this.http.delete('/api/raci-templates/' + t.id).subscribe({
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

  protected t(key: string): string {
    return this.i18n.t(key);
  }

  protected validationErrors(): string[] {
    const errors: string[] = [];
    const d = this.draft();
    const original = this.editingId()
      ? this.templates().find((template) => template.id === this.editingId())
      : null;
    const code = d.code.trim();
    const nameEn = d.nameEn.trim();
    const nameAr = d.nameAr.trim();
    if (!code) errors.push(this.t('validation.codeRequired'));
    else if (!CODE_PATTERN.test(code)) errors.push(this.t('validation.codeFormat'));
    if (code.length > 64) errors.push(this.t('validation.codeLength'));
    if (original && code !== original.code) errors.push(this.t('validation.codeImmutable'));
    if (!nameEn) errors.push(this.t('validation.nameEnRequired'));
    if (!nameAr) errors.push(this.t('validation.nameArRequired'));
    if (nameEn.length > 180 || nameAr.length > 180) errors.push(this.t('validation.nameLength'));
    if (d.description.trim().length > 1000) errors.push(this.t('validation.descriptionLength'));
    if (d.processType.trim().length > 80) errors.push(this.t('validation.shortTextLength'));
    if (d.items.length === 0) errors.push(this.t('validation.raciItemRequired'));
    const roleIds = d.items.map((item) => item.roleTypeId).filter(Boolean);
    if (new Set(roleIds).size !== roleIds.length) errors.push(this.t('validation.raciDuplicateRole'));
    return [...new Set(errors)];
  }
}
