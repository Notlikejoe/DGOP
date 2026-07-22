import { ChangeDetectionStrategy, Component, computed, inject, OnInit, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { HttpClient, HttpParams } from '@angular/common/http';
import { forkJoin } from 'rxjs';
import { I18nService } from '../../../core/i18n.service';
import { AuthService } from '../../../core/auth.service';
import { ToastService } from '../../../shared/toast.service';
import { ConfirmService } from '../../../shared/confirm.service';
import { Modal } from '../../../shared/modal';
import { StatusChip } from '../../../shared/status-chip';

interface Ref { id: string; code?: string; nameEn: string; nameAr: string; }
interface Person { id: string; fullNameEn: string; fullNameAr: string; }

type ScopeType = 'domain' | 'capability' | 'subject' | 'org_unit' | 'system';

interface Rule {
  id: string;
  nameEn: string;
  nameAr: string;
  description?: string | null;
  scopeType: ScopeType;
  refId: string;
  roleTypeId: string;
  personId: string;
  isPrimary: boolean;
  priority: number;
  isActive: boolean;
  roleType: Ref;
  person: Person;
  ref?: Ref | null;
}

interface Draft {
  nameEn: string;
  nameAr: string;
  description: string;
  scopeType: ScopeType;
  refId: string;
  roleTypeId: string;
  personId: string;
  isPrimary: boolean;
  priority: number;
}

interface Filters { scopeType: string; roleTypeId: string; }

const SCOPE_TYPES: ScopeType[] = ['domain', 'capability', 'subject', 'org_unit', 'system'];
const RULE_NAME_MAX = 180;
const RULE_DESCRIPTION_MAX = 1000;
const RULE_PRIORITY_MAX = 9999;

@Component({
  selector: 'app-assignment-rules',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule, Modal, StatusChip],
  templateUrl: './assignment-rules.html',
  styleUrl: './assignment-rules.scss',
})
export class AssignmentRulesPage implements OnInit {
  private readonly http = inject(HttpClient);
  protected readonly i18n = inject(I18nService);
  private readonly auth = inject(AuthService);
  private readonly toast = inject(ToastService);
  private readonly confirm = inject(ConfirmService);

  protected readonly scopeTypes = SCOPE_TYPES;
  protected readonly state = signal<'loading' | 'ok' | 'error'>('loading');
  protected readonly rules = signal<Rule[]>([]);

  protected readonly roleTypes = signal<Ref[]>([]);
  protected readonly people = signal<Person[]>([]);
  protected readonly lookups = signal<Record<ScopeType, Ref[]>>({
    domain: [], capability: [], subject: [], org_unit: [], system: [],
  });

  protected readonly filters = signal<Filters>({ scopeType: '', roleTypeId: '' });

  protected readonly modalOpen = signal(false);
  protected readonly editingId = signal<string | null>(null);
  protected readonly draft = signal<Draft>(this.emptyDraft());
  protected readonly saving = signal(false);

  protected readonly refOptions = computed<Ref[]>(() => this.lookups()[this.draft().scopeType] ?? []);
  protected readonly ruleNameMax = RULE_NAME_MAX;
  protected readonly ruleDescriptionMax = RULE_DESCRIPTION_MAX;
  protected readonly rulePriorityMax = RULE_PRIORITY_MAX;

  ngOnInit(): void {
    this.loadLookups();
    this.load();
  }

  protected get canCreate(): boolean { return this.auth.hasPermission('assignment_rules.create'); }
  protected get canEdit(): boolean { return this.auth.hasPermission('assignment_rules.edit'); }
  protected get canDelete(): boolean { return this.auth.hasPermission('assignment_rules.delete'); }

  protected load(): void {
    this.state.set('loading');
    const f = this.filters();
    let params = new HttpParams();
    for (const [k, v] of Object.entries(f)) if (v) params = params.set(k, v);
    this.http.get<Rule[]>('/api/assignment-rules', { params }).subscribe({
      next: (r) => { this.rules.set(r); this.state.set('ok'); },
      error: () => this.state.set('error'),
    });
  }

  private loadLookups(): void {
    forkJoin({
      roleTypes: this.http.get<Ref[]>('/api/role-types'),
      people: this.http.get<Person[]>('/api/people'),
      domain: this.http.get<Ref[]>('/api/data-domains'),
      capability: this.http.get<Ref[]>('/api/business-capabilities'),
      subject: this.http.get<Ref[]>('/api/data-subjects'),
      org_unit: this.http.get<Ref[]>('/api/org-units'),
      system: this.http.get<Ref[]>('/api/systems'),
    }).subscribe((r) => {
      this.roleTypes.set(r.roleTypes);
      this.people.set(r.people);
      this.lookups.set({
        domain: r.domain, capability: r.capability, subject: r.subject,
        org_unit: r.org_unit, system: r.system,
      });
    });
  }

  protected setFilter<K extends keyof Filters>(key: K, value: Filters[K]): void {
    this.filters.update((f) => ({ ...f, [key]: value }));
    this.load();
  }

  protected name(o?: { nameEn: string; nameAr: string } | null): string {
    if (!o) return '-';
    return this.i18n.lang() === 'ar' ? o.nameAr : o.nameEn;
  }
  protected personName(p?: Person | null): string {
    if (!p) return '-';
    return this.i18n.lang() === 'ar' ? p.fullNameAr : p.fullNameEn;
  }
  protected scopeLabel(s: string): string { return this.t('dim.' + s); }

  private emptyDraft(): Draft {
    return {
      nameEn: '', nameAr: '', description: '', scopeType: 'domain',
      refId: '', roleTypeId: '', personId: '', isPrimary: true, priority: 100,
    };
  }

  protected set<K extends keyof Draft>(key: K, value: Draft[K]): void {
    this.draft.update((d) => {
      const next = { ...d, [key]: value };
      if (key === 'scopeType') next.refId = '';
      return next;
    });
  }

  protected openCreate(): void {
    this.draft.set(this.emptyDraft());
    this.editingId.set(null);
    this.modalOpen.set(true);
  }

  protected openEdit(r: Rule): void {
    this.draft.set({
      nameEn: r.nameEn,
      nameAr: r.nameAr,
      description: r.description ?? '',
      scopeType: r.scopeType,
      refId: r.refId,
      roleTypeId: r.roleTypeId,
      personId: r.personId,
      isPrimary: r.isPrimary,
      priority: r.priority,
    });
    this.editingId.set(r.id);
    this.modalOpen.set(true);
  }

  protected canSave(): boolean {
    const d = this.draft();
    return !!(d.nameEn.trim() && d.nameAr.trim() && d.scopeType && d.refId && d.roleTypeId && d.personId) && this.validationErrors().length === 0;
  }

  protected save(): void {
    if (!this.canSave() || this.saving()) return;
    this.saving.set(true);
    const d = this.draft();
    const body = {
      nameEn: d.nameEn.trim(),
      nameAr: d.nameAr.trim(),
      description: d.description.trim() || null,
      scopeType: d.scopeType,
      refId: d.refId,
      roleTypeId: d.roleTypeId,
      personId: d.personId,
      isPrimary: d.isPrimary,
      priority: Number(d.priority) || 100,
    };
    const id = this.editingId();
    const req = id
      ? this.http.patch('/api/assignment-rules/' + id, body)
      : this.http.post('/api/assignment-rules', body);
    req.subscribe({
      next: () => {
        this.toast.success(this.t(id ? 'rule.updated' : 'rule.created'));
        this.saving.set(false);
        this.modalOpen.set(false);
        this.load();
      },
      error: (err) => { this.toast.errorFrom(err, this.t('rule.saveError')); this.saving.set(false); },
    });
  }

  protected close(): void { this.modalOpen.set(false); }

  protected validationErrors(): string[] {
    const d = this.draft();
    const errors: string[] = [];
    const nameEn = d.nameEn.trim();
    const nameAr = d.nameAr.trim();
    const description = d.description.trim();
    const priority = Number(d.priority);
    if (!nameEn) errors.push(this.t('rule.validation.nameEnRequired'));
    if (!nameAr) errors.push(this.t('rule.validation.nameArRequired'));
    if (nameEn.length > RULE_NAME_MAX || nameAr.length > RULE_NAME_MAX) {
      errors.push(this.t('rule.validation.nameLength'));
    }
    if (description.length > RULE_DESCRIPTION_MAX) {
      errors.push(this.t('rule.validation.descriptionLength'));
    }
    if (!d.scopeType) errors.push(this.t('rule.validation.scopeRequired'));
    if (!d.refId) errors.push(this.t('rule.validation.refRequired'));
    if (!d.roleTypeId) errors.push(this.t('rule.validation.roleRequired'));
    if (!d.personId) errors.push(this.t('rule.validation.personRequired'));
    if (!Number.isInteger(priority) || priority < 1 || priority > RULE_PRIORITY_MAX) {
      errors.push(this.t('rule.validation.priorityRange'));
    }
    const duplicate = this.rules().some((rule) =>
      rule.id !== this.editingId() &&
      rule.isActive &&
      rule.scopeType === d.scopeType &&
      rule.refId === d.refId &&
      rule.roleTypeId === d.roleTypeId &&
      rule.priority === priority,
    );
    if (duplicate) errors.push(this.t('rule.validation.duplicate'));
    return errors;
  }

  protected async remove(r: Rule): Promise<void> {
    const ok = await this.confirm.ask('rule.confirmDelete');
    if (!ok) return;
    this.http.delete('/api/assignment-rules/' + r.id).subscribe({
      next: () => { this.toast.success(this.t('rule.deleted')); this.load(); },
      error: (err) => this.toast.errorFrom(err, this.t('rule.saveError')),
    });
  }

  protected t(key: string): string { return this.i18n.t(key); }
}
