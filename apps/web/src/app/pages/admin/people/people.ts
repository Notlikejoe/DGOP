import { ChangeDetectionStrategy, Component, computed, inject, OnInit, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { HttpClient } from '@angular/common/http';
import { I18nService } from '../../../core/i18n.service';
import { AuthService } from '../../../core/auth.service';
import { ToastService } from '../../../shared/toast.service';
import { ConfirmService } from '../../../shared/confirm.service';
import { Modal } from '../../../shared/modal';
import { StatusChip } from '../../../shared/status-chip';
import { Pager } from '../../../shared/pager';

interface UserRef { id: string; email: string; displayName: string; }

interface Person {
  id: string;
  fullNameEn: string;
  fullNameAr: string;
  email?: string | null;
  jobTitle?: string | null;
  organization?: string | null;
  userId?: string | null;
  user?: UserRef | null;
  isActive: boolean;
}

interface Draft {
  fullNameEn: string;
  fullNameAr: string;
  email: string;
  jobTitle: string;
  organization: string;
  userId: string;
  isActive: boolean;
}

@Component({
  selector: 'app-admin-people',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule, Modal, StatusChip, Pager],
  templateUrl: './people.html',
  styleUrl: './people.scss',
})
export class PeoplePage implements OnInit {
  private readonly http = inject(HttpClient);
  protected readonly i18n = inject(I18nService);
  private readonly auth = inject(AuthService);
  private readonly toast = inject(ToastService);
  private readonly confirm = inject(ConfirmService);

  protected readonly state = signal<'loading' | 'ok' | 'error'>('loading');
  protected readonly people = signal<Person[]>([]);
  protected readonly users = signal<UserRef[]>([]);
  protected readonly search = signal('');

  protected readonly page = signal(1);
  protected readonly pageSize = signal(25);

  protected readonly filtered = computed(() => {
    const q = this.search().trim().toLowerCase();
    if (!q) return this.people();
    return this.people().filter((p) =>
      [p.fullNameEn, p.fullNameAr, p.email, p.jobTitle, p.organization]
        .filter(Boolean)
        .some((v) => (v as string).toLowerCase().includes(q)),
    );
  });

  protected readonly totalPages = computed(() =>
    Math.max(1, Math.ceil(this.filtered().length / this.pageSize())),
  );

  protected readonly paged = computed(() => {
    const start = (this.page() - 1) * this.pageSize();
    return this.filtered().slice(start, start + this.pageSize());
  });

  protected setSearch(value: string): void {
    this.search.set(value);
    this.page.set(1);
  }

  protected goToPage(p: number): void {
    this.page.set(p);
  }

  protected readonly modalOpen = signal(false);
  protected readonly editingId = signal<string | null>(null);
  protected readonly draft = signal<Draft>(this.emptyDraft());
  protected readonly saving = signal(false);

  ngOnInit(): void {
    this.load();
    // Users power the login-account link; tolerate missing users.view permission.
    this.http.get<UserRef[]>('/api/users').subscribe({
      next: (u) => this.users.set(u),
      error: () => {},
    });
  }

  protected userLabel(p: Person): string { return p.user?.displayName ?? p.user?.email ?? '-'; }

  protected get canCreate(): boolean {
    return this.auth.hasPermission('people.create');
  }
  protected get canEdit(): boolean {
    return this.auth.hasPermission('people.edit');
  }
  protected get canDelete(): boolean {
    return this.auth.hasPermission('people.delete');
  }

  protected load(): void {
    this.state.set('loading');
    this.http.get<Person[]>('/api/people').subscribe({
      next: (p) => {
        this.people.set(p);
        this.state.set('ok');
      },
      error: () => this.state.set('error'),
    });
  }

  protected name(p: Person): string {
    return this.i18n.lang() === 'ar' ? p.fullNameAr : p.fullNameEn;
  }

  private emptyDraft(): Draft {
    return { fullNameEn: '', fullNameAr: '', email: '', jobTitle: '', organization: '', userId: '', isActive: true };
  }

  protected set<K extends keyof Draft>(key: K, value: Draft[K]): void {
    this.draft.update((d) => ({ ...d, [key]: value }));
  }

  protected openCreate(): void {
    this.draft.set(this.emptyDraft());
    this.editingId.set(null);
    this.modalOpen.set(true);
  }

  protected openEdit(p: Person): void {
    this.draft.set({
      fullNameEn: p.fullNameEn,
      fullNameAr: p.fullNameAr,
      email: p.email ?? '',
      jobTitle: p.jobTitle ?? '',
      organization: p.organization ?? '',
      userId: p.userId ?? '',
      isActive: p.isActive,
    });
    this.editingId.set(p.id);
    this.modalOpen.set(true);
  }

  protected canSave(): boolean {
    const d = this.draft();
    return !!(d.fullNameEn && d.fullNameAr);
  }

  protected save(): void {
    if (!this.canSave() || this.saving()) return;
    this.saving.set(true);
    const d = this.draft();
    const body = {
      fullNameEn: d.fullNameEn,
      fullNameAr: d.fullNameAr,
      email: d.email || null,
      jobTitle: d.jobTitle || null,
      organization: d.organization || null,
      userId: d.userId || null,
      isActive: d.isActive,
    };
    const id = this.editingId();
    const req = id ? this.http.patch('/api/people/' + id, body) : this.http.post('/api/people', body);
    req.subscribe({
      next: () => {
        this.toast.success(this.t(id ? 'people.updated' : 'people.created'));
        this.saving.set(false);
        this.modalOpen.set(false);
        this.load();
      },
      error: () => {
        this.toast.error(this.t('people.saveError'));
        this.saving.set(false);
      },
    });
  }

  protected close(): void {
    this.modalOpen.set(false);
  }

  protected async remove(p: Person): Promise<void> {
    const ok = await this.confirm.ask('people.confirmDelete');
    if (!ok) return;
    this.http.delete('/api/people/' + p.id).subscribe({
      next: () => {
        this.toast.success(this.t('people.deleted'));
        this.load();
      },
      error: () => this.toast.error(this.t('people.saveError')),
    });
  }

  protected t(key: string): string {
    return this.i18n.t(key);
  }
}
