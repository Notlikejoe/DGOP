import { ChangeDetectionStrategy, Component, computed, inject, OnInit, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { HttpClient, HttpParams } from '@angular/common/http';
import { forkJoin } from 'rxjs';
import { I18nService } from '../../../core/i18n.service';
import { AuthService } from '../../../core/auth.service';
import { ToastService } from '../../../shared/toast.service';
import { ConfirmService } from '../../../shared/confirm.service';
import { Modal } from '../../../shared/modal';
import { StatusChip, StatusKind } from '../../../shared/status-chip';

interface Ref { id: string; code?: string; nameEn: string; nameAr: string; }
interface Person { id: string; fullNameEn: string; fullNameAr: string; }
interface UserRef { id: string; email: string; displayName: string; }

type TargetType = 'asset' | 'domain' | 'capability' | 'subject' | 'org_unit' | 'system';

const APPROVAL_KIND: Record<string, StatusKind> = {
  draft: 'muted', pending: 'warning', approved: 'success', rejected: 'danger',
};

interface Assignment {
  id: string;
  targetType: TargetType;
  targetId: string;
  roleTypeId: string;
  personId: string;
  isPrimary: boolean;
  effectiveDate: string;
  expiryDate?: string | null;
  justification?: string | null;
  source: string;
  approvalStatus: string;
  isActive: boolean;
  isCurrentlyActive: boolean;
  roleType: Ref;
  person: Person;
  target?: Ref | null;
}

interface Conflict {
  targetType: TargetType;
  targetId: string;
  roleType: Ref;
  assignments: { id: string }[];
}

interface Draft {
  targetType: TargetType;
  targetId: string;
  roleTypeId: string;
  personId: string;
  isPrimary: boolean;
  effectiveDate: string;
  expiryDate: string;
  justification: string;
  demoteExisting: boolean;
}

interface Filters {
  targetType: string;
  roleTypeId: string;
  personId: string;
  status: string;
}

const TARGET_TYPES: TargetType[] = ['asset', 'domain', 'capability', 'subject', 'org_unit', 'system'];
const OWNERSHIP_JUSTIFICATION_MAX = 1000;

@Component({
  selector: 'app-ownership',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule, Modal, StatusChip],
  templateUrl: './ownership.html',
  styleUrl: './ownership.scss',
})
export class OwnershipPage implements OnInit {
  private readonly http = inject(HttpClient);
  protected readonly i18n = inject(I18nService);
  private readonly auth = inject(AuthService);
  private readonly toast = inject(ToastService);
  private readonly confirm = inject(ConfirmService);

  protected readonly targetTypes = TARGET_TYPES;
  protected readonly state = signal<'loading' | 'ok' | 'error'>('loading');
  protected readonly assignments = signal<Assignment[]>([]);
  protected readonly conflictIds = signal<Set<string>>(new Set());
  protected readonly conflictCount = signal(0);

  // lookups
  protected readonly roleTypes = signal<Ref[]>([]);
  protected readonly people = signal<Person[]>([]);
  protected readonly users = signal<UserRef[]>([]);
  protected readonly lookups = signal<Record<TargetType, Ref[]>>({
    asset: [], domain: [], capability: [], subject: [], org_unit: [], system: [],
  });

  protected readonly filters = signal<Filters>({ targetType: '', roleTypeId: '', personId: '', status: '' });

  protected readonly modalOpen = signal(false);
  protected readonly editingId = signal<string | null>(null);
  protected readonly draft = signal<Draft>(this.emptyDraft());
  protected readonly saving = signal(false);

  // submit-for-approval modal
  protected readonly submitTarget = signal<Assignment | null>(null);
  protected readonly approverId = signal('');
  protected readonly submitDue = signal('');
  protected readonly submitting = signal(false);

  protected readonly targetOptions = computed<Ref[]>(() => this.lookups()[this.draft().targetType] ?? []);
  protected readonly justificationMax = OWNERSHIP_JUSTIFICATION_MAX;

  ngOnInit(): void {
    this.loadLookups();
    this.load();
    this.loadConflicts();
  }

  protected get canCreate(): boolean { return this.auth.hasPermission('assignments.create'); }
  protected get canEdit(): boolean { return this.auth.hasPermission('assignments.edit'); }
  protected get canDelete(): boolean { return this.auth.hasPermission('assignments.delete'); }
  protected approvalKind(s: string): StatusKind { return APPROVAL_KIND[s] ?? 'muted'; }

  protected load(): void {
    this.state.set('loading');
    const f = this.filters();
    let params = new HttpParams();
    for (const [k, v] of Object.entries(f)) if (v) params = params.set(k, v);
    this.http.get<Assignment[]>('/api/assignments', { params }).subscribe({
      next: (a) => { this.assignments.set(a); this.state.set('ok'); },
      error: () => this.state.set('error'),
    });
  }

  private loadConflicts(): void {
    this.http.get<Conflict[]>('/api/assignments/conflicts').subscribe({
      next: (c) => {
        const ids = new Set<string>();
        c.forEach((g) => g.assignments.forEach((a) => ids.add(a.id)));
        this.conflictIds.set(ids);
        this.conflictCount.set(c.length);
      },
      error: () => {},
    });
  }

  private loadLookups(): void {
    forkJoin({
      roleTypes: this.http.get<Ref[]>('/api/role-types'),
      people: this.http.get<Person[]>('/api/people'),
      asset: this.http.get<Ref[]>('/api/assets'),
      domain: this.http.get<Ref[]>('/api/data-domains'),
      capability: this.http.get<Ref[]>('/api/business-capabilities'),
      subject: this.http.get<Ref[]>('/api/data-subjects'),
      org_unit: this.http.get<Ref[]>('/api/org-units'),
      system: this.http.get<Ref[]>('/api/systems'),
    }).subscribe((r) => {
      this.roleTypes.set(r.roleTypes);
      this.people.set(r.people);
      this.lookups.set({
        asset: r.asset, domain: r.domain, capability: r.capability,
        subject: r.subject, org_unit: r.org_unit, system: r.system,
      });
    });
    // Users power the "submit for approval" approver picker; tolerate missing users.view.
    this.http.get<UserRef[]>('/api/users').subscribe({
      next: (u) => this.users.set(u),
      error: () => {},
    });
  }

  // ---------- submit for approval ----------
  protected get canSubmitForApproval(): boolean { return this.auth.hasPermission('assignments.edit'); }

  protected openSubmit(a: Assignment): void {
    this.submitTarget.set(a);
    this.approverId.set('');
    this.submitDue.set('');
  }
  protected closeSubmit(): void { this.submitTarget.set(null); }

  protected submitForApproval(): void {
    const a = this.submitTarget();
    if (!a || !this.approverId() || this.submitting()) return;
    this.submitting.set(true);
    this.http
      .post('/api/workflow/assignments/submit-for-approval', {
        assignmentId: a.id,
        approverUserId: this.approverId(),
        dueDate: this.submitDue() ? new Date(this.submitDue()).toISOString() : null,
      })
      .subscribe({
        next: () => {
          this.toast.success(this.t('own.submitted'));
          this.submitting.set(false);
          this.submitTarget.set(null);
          this.load();
        },
        error: (err) => { this.toast.errorFrom(err, this.t('own.saveError')); this.submitting.set(false); },
      });
  }

  protected setFilter<K extends keyof Filters>(key: K, value: Filters[K]): void {
    this.filters.update((f) => ({ ...f, [key]: value }));
    this.load();
  }

  // ---------- helpers ----------
  protected name(o?: { nameEn: string; nameAr: string } | null): string {
    if (!o) return '-';
    return this.i18n.lang() === 'ar' ? o.nameAr : o.nameEn;
  }
  protected personName(p?: Person | null): string {
    if (!p) return '-';
    return this.i18n.lang() === 'ar' ? p.fullNameAr : p.fullNameEn;
  }
  protected targetTypeLabel(t: string): string { return this.t('dim.' + t); }
  protected sourceLabel(s: string): string { return this.t('own.source.' + s); }

  protected statusOf(a: Assignment): { kind: StatusKind; key: string } {
    if (!a.isActive) return { kind: 'muted', key: 'own.status.inactive' };
    const now = Date.now();
    if (new Date(a.effectiveDate).getTime() > now) return { kind: 'info', key: 'own.status.scheduled' };
    if (a.expiryDate && new Date(a.expiryDate).getTime() < now) return { kind: 'warning', key: 'own.status.expired' };
    return { kind: 'success', key: 'own.status.active' };
  }

  protected isConflict(a: Assignment): boolean { return this.conflictIds().has(a.id); }
  protected fmtDate(d?: string | null): string { return d ? new Date(d).toISOString().slice(0, 10) : this.t('own.noExpiry'); }
  protected conflictBanner(): string { return this.t('own.conflictBanner').replace('{count}', String(this.conflictCount())); }

  // ---------- create / edit ----------
  private emptyDraft(): Draft {
    return {
      targetType: 'asset', targetId: '', roleTypeId: '', personId: '',
      isPrimary: true, effectiveDate: new Date().toISOString().slice(0, 10), expiryDate: '', justification: '',
      demoteExisting: true,
    };
  }
  protected personNameByUser(u: UserRef): string { return u.displayName; }

  protected set<K extends keyof Draft>(key: K, value: Draft[K]): void {
    this.draft.update((d) => {
      const next = { ...d, [key]: value };
      if (key === 'targetType') next.targetId = '';
      return next;
    });
  }

  protected openCreate(): void {
    this.draft.set(this.emptyDraft());
    this.editingId.set(null);
    this.modalOpen.set(true);
  }

  protected openEdit(a: Assignment): void {
    this.draft.set({
      targetType: a.targetType,
      targetId: a.targetId,
      roleTypeId: a.roleTypeId,
      personId: a.personId,
      isPrimary: a.isPrimary,
      effectiveDate: a.effectiveDate ? a.effectiveDate.slice(0, 10) : '',
      expiryDate: a.expiryDate ? a.expiryDate.slice(0, 10) : '',
      justification: a.justification ?? '',
      demoteExisting: true,
    });
    this.editingId.set(a.id);
    this.modalOpen.set(true);
  }

  protected canSave(): boolean {
    const d = this.draft();
    return !!(d.targetType && d.targetId && d.roleTypeId && d.personId && d.effectiveDate) && this.validationErrors().length === 0;
  }

  protected save(): void {
    if (!this.canSave() || this.saving()) return;
    this.saving.set(true);
    const d = this.draft();
    const id = this.editingId();
    const base = {
      personId: d.personId,
      isPrimary: d.isPrimary,
      effectiveDate: new Date(d.effectiveDate).toISOString(),
      expiryDate: d.expiryDate ? new Date(d.expiryDate).toISOString() : null,
      justification: d.justification.trim() || null,
    };
    const req = id
      ? this.http.patch('/api/assignments/' + id, base)
      : this.http.post('/api/assignments', {
          ...base,
          targetType: d.targetType,
          targetId: d.targetId,
          roleTypeId: d.roleTypeId,
          demoteExisting: d.demoteExisting,
        });
    req.subscribe({
      next: () => {
        this.toast.success(this.t(id ? 'own.updated' : 'own.created'));
        this.saving.set(false);
        this.modalOpen.set(false);
        this.load();
        this.loadConflicts();
      },
      error: (err) => { this.toast.errorFrom(err, this.t('own.saveError')); this.saving.set(false); },
    });
  }

  protected close(): void { this.modalOpen.set(false); }

  private windowsOverlap(
    a: { effectiveDate: string; expiryDate?: string | null },
    b: { effectiveDate: string; expiryDate?: string | null },
  ): boolean {
    const aStart = new Date(a.effectiveDate).getTime();
    const bStart = new Date(b.effectiveDate).getTime();
    const aEnd = a.expiryDate ? new Date(a.expiryDate).getTime() : new Date('9999-12-31').getTime();
    const bEnd = b.expiryDate ? new Date(b.expiryDate).getTime() : new Date('9999-12-31').getTime();
    return aStart <= bEnd && bStart <= aEnd;
  }

  protected validationErrors(): string[] {
    const d = this.draft();
    const errors: string[] = [];
    if (!d.targetType) errors.push(this.t('own.validation.targetTypeRequired'));
    if (!d.targetId) errors.push(this.t('own.validation.targetRequired'));
    if (!d.roleTypeId) errors.push(this.t('own.validation.roleRequired'));
    if (!d.personId) errors.push(this.t('own.validation.personRequired'));
    if (!d.effectiveDate) errors.push(this.t('own.validation.effectiveRequired'));
    if (d.justification.trim().length > OWNERSHIP_JUSTIFICATION_MAX) {
      errors.push(this.t('own.validation.justificationLength'));
    }
    if (d.effectiveDate && d.expiryDate && new Date(d.expiryDate) <= new Date(d.effectiveDate)) {
      errors.push(this.t('own.validation.window'));
    }
    if (d.isPrimary && d.targetId && d.roleTypeId) {
      const overlap = this.assignments().some((assignment) =>
        assignment.id !== this.editingId() &&
        assignment.targetType === d.targetType &&
        assignment.targetId === d.targetId &&
        assignment.roleTypeId === d.roleTypeId &&
        assignment.isPrimary &&
        assignment.isActive &&
        assignment.approvalStatus === 'approved' &&
        this.windowsOverlap(
          { effectiveDate: d.effectiveDate, expiryDate: d.expiryDate || null },
          assignment,
        ),
      );
      if (overlap && (this.editingId() || !d.demoteExisting)) {
        errors.push(this.t('own.validation.primaryConflict'));
      }
    }
    return errors;
  }

  protected async remove(a: Assignment): Promise<void> {
    const ok = await this.confirm.ask('own.confirmDelete');
    if (!ok) return;
    this.http.delete('/api/assignments/' + a.id).subscribe({
      next: () => { this.toast.success(this.t('own.deleted')); this.load(); this.loadConflicts(); },
      error: (err) => this.toast.errorFrom(err, this.t('own.saveError')),
    });
  }

  protected t(key: string): string { return this.i18n.t(key); }
}
