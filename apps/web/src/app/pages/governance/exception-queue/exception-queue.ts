import { ChangeDetectionStrategy, Component, inject, OnInit, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { HttpClient } from '@angular/common/http';
import { forkJoin } from 'rxjs';
import { I18nService } from '../../../core/i18n.service';
import { AuthService } from '../../../core/auth.service';
import { ToastService } from '../../../shared/toast.service';
import { Modal } from '../../../shared/modal';

interface Ref { id: string; code?: string; nameEn: string; nameAr: string; }
interface Person { id: string; fullNameEn: string; fullNameAr: string; }

interface ExceptionAsset {
  id: string;
  code: string;
  nameEn: string;
  nameAr: string;
  domain?: { nameEn: string; nameAr: string } | null;
  classification?: { nameEn: string; nameAr: string; color: string } | null;
  reason: string;
}

@Component({
  selector: 'app-exception-queue',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule, Modal],
  templateUrl: './exception-queue.html',
  styleUrl: './exception-queue.scss',
})
export class ExceptionQueuePage implements OnInit {
  private readonly http = inject(HttpClient);
  protected readonly i18n = inject(I18nService);
  private readonly auth = inject(AuthService);
  private readonly toast = inject(ToastService);

  protected readonly state = signal<'loading' | 'ok' | 'error'>('loading');
  protected readonly items = signal<ExceptionAsset[]>([]);
  protected readonly people = signal<Person[]>([]);
  private readonly ownerRoleId = signal<string | null>(null);

  protected readonly modalOpen = signal(false);
  protected readonly target = signal<ExceptionAsset | null>(null);
  protected readonly personId = signal('');
  protected readonly saving = signal(false);

  ngOnInit(): void {
    this.load();
    this.loadLookups();
  }

  protected get canAssign(): boolean {
    return this.auth.hasPermission('assignments.create') && !!this.ownerRoleId();
  }

  protected load(): void {
    this.state.set('loading');
    this.http.get<ExceptionAsset[]>('/api/assignments/exceptions').subscribe({
      next: (x) => { this.items.set(x); this.state.set('ok'); },
      error: () => this.state.set('error'),
    });
  }

  private loadLookups(): void {
    forkJoin({
      roleTypes: this.http.get<(Ref & { code: string })[]>('/api/role-types'),
      people: this.http.get<Person[]>('/api/people'),
    }).subscribe((r) => {
      this.ownerRoleId.set(r.roleTypes.find((rt) => rt.code === 'data_owner')?.id ?? null);
      this.people.set(r.people);
    });
  }

  protected name(o?: { nameEn: string; nameAr: string } | null): string {
    if (!o) return '-';
    return this.i18n.lang() === 'ar' ? o.nameAr : o.nameEn;
  }
  protected personName(p: Person): string {
    return this.i18n.lang() === 'ar' ? p.fullNameAr : p.fullNameEn;
  }

  protected openAssign(item: ExceptionAsset): void {
    this.target.set(item);
    this.personId.set('');
    this.modalOpen.set(true);
  }

  protected close(): void { this.modalOpen.set(false); }

  protected assign(): void {
    const item = this.target();
    const roleId = this.ownerRoleId();
    if (!item || !roleId || !this.personId() || this.saving()) return;
    this.saving.set(true);
    this.http.post('/api/assignments', {
      targetType: 'asset',
      targetId: item.id,
      roleTypeId: roleId,
      personId: this.personId(),
      isPrimary: true,
    }).subscribe({
      next: () => {
        this.toast.success(this.t('exc.assigned'));
        this.saving.set(false);
        this.modalOpen.set(false);
        this.load();
      },
      error: (err) => { this.toast.errorFrom(err, this.t('exc.saveError')); this.saving.set(false); },
    });
  }

  protected t(key: string): string { return this.i18n.t(key); }
}
