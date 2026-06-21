import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  OnInit,
  signal,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { HttpClient } from '@angular/common/http';
import { forkJoin } from 'rxjs';
import { I18nService } from '../../../core/i18n.service';
import { AuthService } from '../../../core/auth.service';
import { ToastService } from '../../../shared/toast.service';
import { ConfirmService } from '../../../shared/confirm.service';
import { Modal } from '../../../shared/modal';
import { StatusChip } from '../../../shared/status-chip';

interface RoleListItem {
  id: string;
  code: string;
  nameEn: string;
  nameAr: string;
  description: string | null;
  isSystem: boolean;
  isActive: boolean;
  maxClassificationRank: number | null;
  userCount: number;
  permissionCount: number;
}

interface ScopeEntry {
  scopeType: 'org_unit' | 'data_domain';
  refId: string;
  includeDescendants: boolean;
}

interface RoleDetail extends RoleListItem {
  permissions: string[];
  scopes: ScopeEntry[];
}

interface PermissionItem {
  id: string;
  resource: string;
  action: string;
}

interface Lookup {
  id: string;
  code: string;
  nameEn: string;
  nameAr: string;
}

interface Classification {
  id: string;
  rank: number;
  nameEn: string;
  nameAr: string;
}

interface ScopePreview {
  orgUnits: string[] | 'all';
  domains: string[] | 'all';
  maxClassRank: number | null;
}

type Mode = 'none' | 'create' | 'edit' | 'perms' | 'scope';
type State = 'loading' | 'ok' | 'error';

const ACTIONS = ['view', 'create', 'edit', 'delete'] as const;
const RES_ORDER = [
  'dashboard',
  'design_system',
  'roles',
  'users',
  'data_domains',
  'data_subjects',
  'business_capabilities',
  'org_units',
  'systems',
  'classifications',
  'role_types',
  'raci_templates',
  'status_values',
  'audit',
];

@Component({
  selector: 'app-roles',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule, Modal, StatusChip],
  templateUrl: './roles.html',
  styleUrl: './roles.scss',
})
export class RolesPage implements OnInit {
  private readonly http = inject(HttpClient);
  protected readonly i18n = inject(I18nService);
  protected readonly auth = inject(AuthService);
  private readonly toast = inject(ToastService);
  private readonly confirm = inject(ConfirmService);

  protected readonly state = signal<State>('loading');
  protected readonly roles = signal<RoleListItem[]>([]);
  protected readonly catalog = signal<PermissionItem[]>([]);
  protected readonly orgUnits = signal<Lookup[]>([]);
  protected readonly domains = signal<Lookup[]>([]);
  protected readonly classifications = signal<Classification[]>([]);

  protected readonly mode = signal<Mode>('none');
  protected readonly active = signal<RoleDetail | null>(null);
  protected readonly saving = signal(false);
  protected readonly formError = signal(false);

  // Detail form
  protected form = { code: '', nameEn: '', nameAr: '', description: '', isActive: true };
  // Permission matrix selection
  protected readonly permSel = signal<Set<string>>(new Set());
  // Scope selection: refId -> includeDescendants
  protected readonly orgSel = signal<Map<string, boolean>>(new Map());
  protected readonly domSel = signal<Map<string, boolean>>(new Map());
  protected readonly maxClass = signal<number | null>(null);
  protected readonly preview = signal<ScopePreview | null>(null);

  protected readonly actions = ACTIONS;

  /** Resources (rows) with the set of actions available in the catalog. */
  protected readonly resourceRows = computed(() => {
    const byRes = new Map<string, Set<string>>();
    for (const p of this.catalog()) {
      const set = byRes.get(p.resource) ?? new Set<string>();
      set.add(p.action);
      byRes.set(p.resource, set);
    }
    const ordered = [...byRes.keys()].sort(
      (a, b) => idx(a) - idx(b) || a.localeCompare(b),
    );
    return ordered.map((resource) => ({ resource, actions: byRes.get(resource)! }));
    function idx(r: string): number {
      const i = RES_ORDER.indexOf(r);
      return i === -1 ? 999 : i;
    }
  });

  ngOnInit(): void {
    this.load();
  }

  protected load(): void {
    this.state.set('loading');
    forkJoin({
      roles: this.http.get<RoleListItem[]>('/api/roles'),
      catalog: this.http.get<PermissionItem[]>('/api/permissions'),
      orgUnits: this.http.get<Lookup[]>('/api/org-units'),
      domains: this.http.get<Lookup[]>('/api/data-domains'),
      classifications: this.http.get<Classification[]>('/api/classifications'),
    }).subscribe({
      next: (r) => {
        this.roles.set(r.roles);
        this.catalog.set(r.catalog);
        this.orgUnits.set(r.orgUnits);
        this.domains.set(r.domains);
        this.classifications.set([...r.classifications].sort((a, b) => a.rank - b.rank));
        this.state.set('ok');
      },
      error: () => this.state.set('error'),
    });
  }

  protected name(o: { nameEn: string; nameAr: string }): string {
    return this.i18n.lang() === 'ar' ? o.nameAr : o.nameEn;
  }

  protected t(key: string): string {
    return this.i18n.t(key);
  }

  protected isSysAdmin(role: { code: string }): boolean {
    return role.code === 'system_admin';
  }

  // --- Details modal ---
  protected openCreate(): void {
    this.form = { code: '', nameEn: '', nameAr: '', description: '', isActive: true };
    this.active.set(null);
    this.formError.set(false);
    this.mode.set('create');
  }

  protected openEdit(role: RoleListItem): void {
    this.fetchDetail(role.id, (d) => {
      this.form = {
        code: d.code,
        nameEn: d.nameEn,
        nameAr: d.nameAr,
        description: d.description ?? '',
        isActive: d.isActive,
      };
      this.formError.set(false);
      this.mode.set('edit');
    });
  }

  protected saveDetails(): void {
    if (!this.form.nameEn.trim() || !this.form.nameAr.trim()) {
      this.formError.set(true);
      return;
    }
    this.saving.set(true);
    const creating = this.mode() === 'create';
    const body: Record<string, unknown> = {
      nameEn: this.form.nameEn.trim(),
      nameAr: this.form.nameAr.trim(),
      description: this.form.description.trim() || undefined,
      isActive: this.form.isActive,
    };
    if (creating) {
      if (!/^[a-z][a-z0-9_]*$/.test(this.form.code)) {
        this.saving.set(false);
        this.formError.set(true);
        return;
      }
      body['code'] = this.form.code;
    }
    const req = creating
      ? this.http.post('/api/roles', body)
      : this.http.patch(`/api/roles/${this.active()!.id}`, body);
    req.subscribe({
      next: () => {
        this.saving.set(false);
        this.toast.success(this.t('roles.saved'));
        this.close();
        this.load();
      },
      error: () => {
        this.saving.set(false);
        this.formError.set(true);
        this.toast.error(this.t('crud.saveError'));
      },
    });
  }

  // --- Permissions modal ---
  protected openPerms(role: RoleListItem): void {
    this.fetchDetail(role.id, (d) => {
      this.permSel.set(new Set(d.permissions));
      this.mode.set('perms');
    });
  }

  protected permKey(resource: string, action: string): string {
    return `${resource}.${action}`;
  }

  protected hasPerm(resource: string, action: string): boolean {
    return this.permSel().has(this.permKey(resource, action));
  }

  protected togglePerm(resource: string, action: string): void {
    const key = this.permKey(resource, action);
    const next = new Set(this.permSel());
    if (next.has(key)) next.delete(key);
    else next.add(key);
    this.permSel.set(next);
  }

  protected toggleResourceAll(resource: string, actions: Set<string>): void {
    const keys = [...actions].map((a) => this.permKey(resource, a));
    const allOn = keys.every((k) => this.permSel().has(k));
    const next = new Set(this.permSel());
    for (const k of keys) {
      if (allOn) next.delete(k);
      else next.add(k);
    }
    this.permSel.set(next);
  }

  protected savePerms(): void {
    this.saving.set(true);
    this.http
      .put(`/api/roles/${this.active()!.id}/permissions`, {
        permissions: [...this.permSel()],
      })
      .subscribe({
        next: () => {
          this.saving.set(false);
          this.toast.success(this.t('roles.permsSaved'));
          this.close();
          this.load();
        },
        error: () => {
          this.saving.set(false);
          this.toast.error(this.t('crud.saveError'));
        },
      });
  }

  // --- Scope modal ---
  protected openScope(role: RoleListItem): void {
    this.fetchDetail(role.id, (d) => {
      const org = new Map<string, boolean>();
      const dom = new Map<string, boolean>();
      for (const s of d.scopes) {
        if (s.scopeType === 'org_unit') org.set(s.refId, s.includeDescendants);
        else dom.set(s.refId, s.includeDescendants);
      }
      this.orgSel.set(org);
      this.domSel.set(dom);
      this.maxClass.set(d.maxClassificationRank);
      this.mode.set('scope');
      this.refreshPreview(role.id);
    });
  }

  protected orgChecked(id: string): boolean {
    return this.orgSel().has(id);
  }
  protected domChecked(id: string): boolean {
    return this.domSel().has(id);
  }

  protected toggleScope(map: 'org' | 'dom', id: string): void {
    const sig = map === 'org' ? this.orgSel : this.domSel;
    const next = new Map(sig());
    if (next.has(id)) next.delete(id);
    else next.set(id, true);
    sig.set(next);
  }

  protected descChecked(map: 'org' | 'dom', id: string): boolean {
    const sig = map === 'org' ? this.orgSel : this.domSel;
    return sig().get(id) ?? false;
  }

  protected toggleDesc(map: 'org' | 'dom', id: string): void {
    const sig = map === 'org' ? this.orgSel : this.domSel;
    if (!sig().has(id)) return;
    const next = new Map(sig());
    next.set(id, !next.get(id));
    sig.set(next);
  }

  protected onMaxClassChange(value: string): void {
    this.maxClass.set(value === '' ? null : Number(value));
  }

  protected saveScope(): void {
    this.saving.set(true);
    const scopes: ScopeEntry[] = [
      ...[...this.orgSel().entries()].map(([refId, includeDescendants]) => ({
        scopeType: 'org_unit' as const,
        refId,
        includeDescendants,
      })),
      ...[...this.domSel().entries()].map(([refId, includeDescendants]) => ({
        scopeType: 'data_domain' as const,
        refId,
        includeDescendants,
      })),
    ];
    this.http
      .put(`/api/roles/${this.active()!.id}/scopes`, {
        scopes,
        maxClassificationRank: this.maxClass(),
      })
      .subscribe({
        next: () => {
          this.saving.set(false);
          this.toast.success(this.t('roles.scopeSaved'));
          this.refreshPreview(this.active()!.id);
          this.load();
        },
        error: () => {
          this.saving.set(false);
          this.toast.error(this.t('crud.saveError'));
        },
      });
  }

  private refreshPreview(id: string): void {
    this.http.get<ScopePreview>(`/api/roles/${id}/scope-preview`).subscribe({
      next: (p) => this.preview.set(p),
      error: () => this.preview.set(null),
    });
  }

  protected previewOrgCount(): number | 'all' {
    const p = this.preview();
    if (!p) return 0;
    return p.orgUnits === 'all' ? 'all' : p.orgUnits.length;
  }
  protected previewDomCount(): number | 'all' {
    const p = this.preview();
    if (!p) return 0;
    return p.domains === 'all' ? 'all' : p.domains.length;
  }
  protected previewClass(): string {
    const p = this.preview();
    if (!p || p.maxClassRank == null) return this.t('roles.scope.unrestricted');
    const c = this.classifications().find((x) => x.rank === p.maxClassRank);
    return c ? this.name(c) : String(p.maxClassRank);
  }

  // --- Delete ---
  protected async remove(role: RoleListItem): Promise<void> {
    const ok = await this.confirm.ask('crud.confirmDelete');
    if (!ok) return;
    this.http.delete(`/api/roles/${role.id}`).subscribe({
      next: () => {
        this.toast.success(this.t('crud.deleted'));
        this.load();
      },
      error: () => this.toast.error(this.t('crud.deleteError')),
    });
  }

  protected close(): void {
    this.mode.set('none');
    this.active.set(null);
    this.preview.set(null);
  }

  private fetchDetail(id: string, then: (d: RoleDetail) => void): void {
    this.http.get<RoleDetail>(`/api/roles/${id}`).subscribe({
      next: (d) => {
        this.active.set(d);
        then(d);
      },
      error: () => this.toast.error(this.t('crud.loadError')),
    });
  }
}
