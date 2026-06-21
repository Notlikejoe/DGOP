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
import { StatusChip } from '../../../shared/status-chip';
import { MasterDataConfig, FieldConfig } from './master-data.types';

interface Row {
  id: string;
  [key: string]: unknown;
}

type State = 'loading' | 'ok' | 'error';

@Component({
  selector: 'app-master-data',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule, Modal, StatusChip],
  templateUrl: './master-data-page.html',
  styleUrl: './master-data-page.scss',
})
export class MasterDataPage implements OnInit {
  readonly config = input.required<MasterDataConfig>();

  private readonly http = inject(HttpClient);
  protected readonly i18n = inject(I18nService);
  private readonly toast = inject(ToastService);
  private readonly confirm = inject(ConfirmService);

  protected readonly state = signal<State>('loading');
  protected readonly rows = signal<Row[]>([]);
  protected readonly options = signal<Record<string, { value: string; en: string; ar: string }[]>>({});

  // Search / filter / pagination
  protected readonly search = signal('');
  protected readonly statusFilter = signal<'all' | 'active' | 'inactive'>('all');
  protected readonly page = signal(1);
  protected readonly pageSize = 10;

  protected readonly filtered = computed<Row[]>(() => {
    const term = this.search().trim().toLowerCase();
    const status = this.statusFilter();
    return this.rows().filter((r) => {
      if (status === 'active' && !r['isActive']) return false;
      if (status === 'inactive' && r['isActive']) return false;
      if (!term) return true;
      const hay = [r['code'], r['nameEn'], r['nameAr'], r['domain']]
        .map((v) => String(v ?? '').toLowerCase())
        .join(' ');
      return hay.includes(term);
    });
  });

  protected readonly totalPages = computed(() =>
    Math.max(1, Math.ceil(this.filtered().length / this.pageSize)),
  );

  protected readonly paged = computed<Row[]>(() => {
    const start = (this.page() - 1) * this.pageSize;
    return this.filtered().slice(start, start + this.pageSize);
  });

  protected readonly modalOpen = signal(false);
  protected readonly editingId = signal<string | null>(null);
  protected readonly model = signal<Record<string, unknown>>({});
  protected readonly saving = signal(false);

  ngOnInit(): void {
    this.load();
    this.loadOptions();
  }

  private get base(): string {
    return this.config().apiBase;
  }

  protected load(): void {
    this.state.set('loading');
    this.http.get<Row[]>(this.base).subscribe({
      next: (rows) => {
        this.rows.set(rows);
        if (this.page() > this.totalPages()) this.page.set(this.totalPages());
        this.state.set('ok');
      },
      error: () => this.state.set('error'),
    });
  }

  private loadOptions(): void {
    for (const field of this.config().fields) {
      if (!field.optionsFrom) continue;
      this.http
        .get<{ id: string; nameEn: string; nameAr: string }[]>(field.optionsFrom)
        .subscribe((list) => {
          this.options.update((map) => ({
            ...map,
            [field.key]: list.map((o) => ({ value: o.id, en: o.nameEn, ar: o.nameAr })),
          }));
        });
    }
  }

  protected optionLabel(opt: { en: string; ar: string }): string {
    return this.i18n.lang() === 'ar' ? opt.ar : opt.en;
  }

  protected i18nName(row: Row): string {
    return (this.i18n.lang() === 'ar' ? (row['nameAr'] as string) : (row['nameEn'] as string)) ?? '-';
  }

  protected localized(obj: unknown): string {
    if (!obj || typeof obj !== 'object') return '-';
    const o = obj as { nameEn?: string; nameAr?: string };
    return (this.i18n.lang() === 'ar' ? o.nameAr : o.nameEn) ?? '-';
  }

  protected openCreate(): void {
    const model: Record<string, unknown> = {};
    for (const f of this.config().fields) {
      model[f.key] = f.type === 'checkbox' ? true : f.type === 'number' ? null : '';
    }
    this.model.set(model);
    this.editingId.set(null);
    this.modalOpen.set(true);
  }

  protected openEdit(row: Row): void {
    const model: Record<string, unknown> = {};
    for (const f of this.config().fields) {
      model[f.key] = row[f.key] ?? (f.type === 'checkbox' ? false : '');
    }
    this.model.set(model);
    this.editingId.set(row.id);
    this.modalOpen.set(true);
  }

  protected setField(key: string, value: unknown): void {
    this.model.update((m) => ({ ...m, [key]: value }));
  }

  protected close(): void {
    this.modalOpen.set(false);
  }

  protected canSave(): boolean {
    const m = this.model();
    return this.config().fields.every(
      (f) => !f.required || (m[f.key] !== '' && m[f.key] !== null && m[f.key] !== undefined),
    );
  }

  protected save(): void {
    if (!this.canSave() || this.saving()) return;
    this.saving.set(true);
    const body = this.buildBody();
    const id = this.editingId();
    const req = id
      ? this.http.patch(`${this.base}/${id}`, body)
      : this.http.post(this.base, body);
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

  private buildBody(): Record<string, unknown> {
    const m = this.model();
    const body: Record<string, unknown> = {};
    for (const f of this.config().fields) {
      let v = m[f.key];
      if (f.type === 'number' && v !== null && v !== '') v = Number(v);
      if (f.type === 'select' && v === '') v = null;
      body[f.key] = v;
    }
    return body;
  }

  protected async deleteRow(row: Row): Promise<void> {
    const ok = await this.confirm.ask('crud.confirmDelete');
    if (!ok) return;
    this.http.delete(`${this.base}/${row.id}`).subscribe({
      next: () => {
        this.toast.success(this.i18n.t('crud.deleted'));
        this.load();
      },
      error: () => this.toast.error(this.i18n.t('crud.deleteError')),
    });
  }

  protected onSearch(value: string): void {
    this.search.set(value);
    this.page.set(1);
  }

  protected onStatusFilter(value: 'all' | 'active' | 'inactive'): void {
    this.statusFilter.set(value);
    this.page.set(1);
  }

  protected prevPage(): void {
    this.page.update((p) => Math.max(1, p - 1));
  }

  protected nextPage(): void {
    this.page.update((p) => Math.min(this.totalPages(), p + 1));
  }

  protected fieldOptions(field: FieldConfig) {
    return this.options()[field.key] ?? [];
  }

  protected t(key: string): string {
    return this.i18n.t(key);
  }
}
