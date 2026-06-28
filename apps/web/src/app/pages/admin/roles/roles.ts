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
import { AppIcon } from '../../../shared/app-icon';

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

interface PermissionResourceRow {
  resource: string;
  actions: Set<string>;
}

interface PermissionGroup {
  labelKey: string;
  rows: PermissionResourceRow[];
}

type Mode = 'none' | 'create' | 'edit' | 'perms' | 'scope';
type State = 'loading' | 'ok' | 'error';
type RoleTypeFilter = 'all' | 'system' | 'custom';
type RoleStatusFilter = 'all' | 'active' | 'inactive';

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

const RESOURCE_GROUPS = [
  {
    labelKey: 'roles.permissions.group.access',
    resources: ['roles', 'users', 'audit'],
  },
  {
    labelKey: 'roles.permissions.group.governance',
    resources: ['data_domains', 'data_subjects', 'business_capabilities', 'org_units', 'systems'],
  },
  {
    labelKey: 'roles.permissions.group.foundation',
    resources: ['dashboard', 'design_system'],
  },
  {
    labelKey: 'roles.permissions.group.reference',
    resources: ['classifications', 'role_types', 'raci_templates', 'status_values'],
  },
];

@Component({
  selector: 'app-roles',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule, Modal, StatusChip, AppIcon],
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

  protected readonly roleSearch = signal('');
  protected readonly typeFilter = signal<RoleTypeFilter>('all');
  protected readonly roleStatusFilter = signal<RoleStatusFilter>('all');
  protected readonly selectedRoleId = signal<string | null>(null);
  protected readonly selectedPreview = signal<ScopePreview | null>(null);

  protected readonly mode = signal<Mode>('none');
  protected readonly active = signal<RoleDetail | null>(null);
  protected readonly saving = signal(false);
  protected readonly formError = signal(false);

  protected form = { code: '', nameEn: '', nameAr: '', description: '', isActive: true };
  protected readonly permSel = signal<Set<string>>(new Set());
  protected readonly orgSel = signal<Map<string, boolean>>(new Map());
  protected readonly domSel = signal<Map<string, boolean>>(new Map());
  protected readonly maxClass = signal<number | null>(null);
  protected readonly preview = signal<ScopePreview | null>(null);

  protected readonly actions = ACTIONS;

  protected readonly metrics = computed(() => {
    const roles = this.roles();
    return {
      total: roles.length,
      system: roles.filter((role) => role.isSystem).length,
      custom: roles.filter((role) => !role.isSystem).length,
      assignedUsers: roles.reduce((sum, role) => sum + role.userCount, 0),
      permissionGrants: roles.reduce((sum, role) => sum + role.permissionCount, 0),
    };
  });

  protected readonly filteredRoles = computed(() => {
    const query = this.roleSearch().trim().toLowerCase();
    const type = this.typeFilter();
    const status = this.roleStatusFilter();

    return this.roles().filter((role) => {
      const matchesQuery =
        !query ||
        role.code.toLowerCase().includes(query) ||
        role.nameEn.toLowerCase().includes(query) ||
        role.nameAr.toLowerCase().includes(query);
      const matchesType =
        type === 'all' ||
        (type === 'system' && role.isSystem) ||
        (type === 'custom' && !role.isSystem);
      const matchesStatus =
        status === 'all' ||
        (status === 'active' && role.isActive) ||
        (status === 'inactive' && !role.isActive);
      return matchesQuery && matchesType && matchesStatus;
    });
  });

  protected readonly selectedRole = computed(() => {
    const roles = this.filteredRoles();
    const selectedId = this.selectedRoleId();
    return roles.find((role) => role.id === selectedId) ?? roles[0] ?? null;
  });

  protected readonly resourceRows = computed(() => {
    const byRes = new Map<string, Set<string>>();
    for (const permission of this.catalog()) {
      const set = byRes.get(permission.resource) ?? new Set<string>();
      set.add(permission.action);
      byRes.set(permission.resource, set);
    }
    const ordered = [...byRes.keys()].sort(
      (a, b) => idx(a) - idx(b) || a.localeCompare(b),
    );
    return ordered.map((resource) => ({ resource, actions: byRes.get(resource)! }));
    function idx(resource: string): number {
      const i = RES_ORDER.indexOf(resource);
      return i === -1 ? 999 : i;
    }
  });

  protected readonly permissionGroups = computed<PermissionGroup[]>(() => {
    const rows = this.resourceRows();
    const byResource = new Map(rows.map((row) => [row.resource, row]));
    const used = new Set<string>();
    const groups = RESOURCE_GROUPS.map((group) => {
      const groupRows = group.resources
        .map((resource) => byResource.get(resource))
        .filter((row): row is PermissionResourceRow => Boolean(row));
      for (const row of groupRows) used.add(row.resource);
      return { labelKey: group.labelKey, rows: groupRows };
    }).filter((group) => group.rows.length > 0);

    const otherRows = rows.filter((row) => !used.has(row.resource));
    if (otherRows.length) {
      groups.push({ labelKey: 'roles.permissions.group.other', rows: otherRows });
    }
    return groups;
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
      next: (result) => {
        const selectedId = this.selectedRoleId();
        this.roles.set(result.roles);
        this.catalog.set(result.catalog);
        this.orgUnits.set(result.orgUnits);
        this.domains.set(result.domains);
        this.classifications.set([...result.classifications].sort((a, b) => a.rank - b.rank));
        const nextSelected =
          selectedId && result.roles.some((role) => role.id === selectedId)
            ? selectedId
            : result.roles[0]?.id ?? null;
        this.selectedRoleId.set(nextSelected);
        if (nextSelected) this.refreshSelectedPreview(nextSelected);
        else this.selectedPreview.set(null);
        this.state.set('ok');
      },
      error: () => this.state.set('error'),
    });
  }

  protected name(option: { nameEn: string; nameAr: string }): string {
    return this.i18n.lang() === 'ar' ? option.nameAr : option.nameEn;
  }

  protected t(key: string): string {
    return this.i18n.t(key);
  }

  protected isSysAdmin(role: { code: string }): boolean {
    return role.code === 'system_admin';
  }

  protected selectRole(role: RoleListItem): void {
    this.selectedRoleId.set(role.id);
    this.refreshSelectedPreview(role.id);
  }

  protected clearFilters(): void {
    this.roleSearch.set('');
    this.typeFilter.set('all');
    this.roleStatusFilter.set('all');
  }

  protected roleDescription(role: RoleListItem): string {
    return role.description?.trim() || this.t('roles.noDescription');
  }

  protected classificationLabel(rank: number | null): string {
    if (rank == null) return this.t('roles.scope.unrestricted');
    const classification = this.classifications().find((item) => item.rank === rank);
    return classification ? this.name(classification) : String(rank);
  }

  protected permissionDisplay(role: RoleListItem): string {
    return this.isSysAdmin(role) ? this.t('roles.permissionAll') : String(role.permissionCount);
  }

  protected previewOrgCount(source: ScopePreview | null = this.preview()): number | 'all' {
    if (!source) return 0;
    return source.orgUnits === 'all' ? 'all' : source.orgUnits.length;
  }

  protected previewDomCount(source: ScopePreview | null = this.preview()): number | 'all' {
    if (!source) return 0;
    return source.domains === 'all' ? 'all' : source.domains.length;
  }

  protected previewClass(source: ScopePreview | null = this.preview()): string {
    if (!source) return this.t('roles.scope.unrestricted');
    return this.classificationLabel(source.maxClassRank);
  }

  protected selectedPermissionCount(): number {
    return this.permSel().size;
  }

  protected resourceSelectedCount(resource: string, actions: Set<string>): number {
    return [...actions].filter((action) => this.hasPerm(resource, action)).length;
  }

  protected resourceAllSelected(resource: string, actions: Set<string>): boolean {
    return [...actions].every((action) => this.hasPerm(resource, action));
  }

  protected resourceSomeSelected(resource: string, actions: Set<string>): boolean {
    return !this.resourceAllSelected(resource, actions) && this.resourceSelectedCount(resource, actions) > 0;
  }

  protected selectedScopeCount(kind: 'org' | 'dom'): number {
    return kind === 'org' ? this.orgSel().size : this.domSel().size;
  }

  protected openCreate(): void {
    this.form = { code: '', nameEn: '', nameAr: '', description: '', isActive: true };
    this.active.set(null);
    this.formError.set(false);
    this.mode.set('create');
  }

  protected openEdit(role: RoleListItem): void {
    this.fetchDetail(role.id, (detail) => {
      this.form = {
        code: detail.code,
        nameEn: detail.nameEn,
        nameAr: detail.nameAr,
        description: detail.description ?? '',
        isActive: detail.isActive,
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

  protected openPerms(role: RoleListItem): void {
    this.fetchDetail(role.id, (detail) => {
      this.permSel.set(new Set(detail.permissions));
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
    const keys = [...actions].map((action) => this.permKey(resource, action));
    const allOn = keys.every((key) => this.permSel().has(key));
    const next = new Set(this.permSel());
    for (const key of keys) {
      if (allOn) next.delete(key);
      else next.add(key);
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

  protected openScope(role: RoleListItem): void {
    this.fetchDetail(role.id, (detail) => {
      const org = new Map<string, boolean>();
      const dom = new Map<string, boolean>();
      for (const scope of detail.scopes) {
        if (scope.scopeType === 'org_unit') org.set(scope.refId, scope.includeDescendants);
        else dom.set(scope.refId, scope.includeDescendants);
      }
      this.orgSel.set(org);
      this.domSel.set(dom);
      this.maxClass.set(detail.maxClassificationRank);
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
          const id = this.active()!.id;
          this.refreshPreview(id);
          this.refreshSelectedPreview(id);
          this.load();
        },
        error: () => {
          this.saving.set(false);
          this.toast.error(this.t('crud.saveError'));
        },
      });
  }

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

  private refreshPreview(id: string): void {
    this.http.get<ScopePreview>(`/api/roles/${id}/scope-preview`).subscribe({
      next: (p) => this.preview.set(p),
      error: () => this.preview.set(null),
    });
  }

  private refreshSelectedPreview(id: string): void {
    this.http.get<ScopePreview>(`/api/roles/${id}/scope-preview`).subscribe({
      next: (p) => this.selectedPreview.set(p),
      error: () => this.selectedPreview.set(null),
    });
  }

  private fetchDetail(id: string, then: (detail: RoleDetail) => void): void {
    this.http.get<RoleDetail>(`/api/roles/${id}`).subscribe({
      next: (detail) => {
        this.active.set(detail);
        then(detail);
      },
      error: () => this.toast.error(this.t('crud.loadError')),
    });
  }
}
