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
import { MultiSelectModule } from 'primeng/multiselect';

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

interface PermissionScreenDefinition {
  id: string;
  labelKey: string;
  resources: string[];
}

interface PermissionScreen extends PermissionScreenDefinition {
  rows: PermissionResourceRow[];
}

interface PermissionGroup {
  labelKey: string;
  screens: PermissionScreen[];
}

type Mode = 'none' | 'create' | 'edit' | 'perms' | 'scope';
type State = 'loading' | 'ok' | 'error';
type RoleTypeFilter = 'system' | 'custom';
type RoleStatusFilter = 'active' | 'inactive';

const ACTION_ORDER = [
  'view',
  'create',
  'edit',
  'delete',
  'import',
  'review',
  'generate',
  'download',
  'run',
  'writeback',
  'analytics',
  'baseline_accept',
];

const PERMISSION_SCREEN_GROUPS: Array<{
  labelKey: string;
  screens: PermissionScreenDefinition[];
}> = [
  {
    labelKey: 'roles.permissions.group.foundation',
    screens: [
      { id: 'command-center', labelKey: 'nav.dashboard', resources: ['dashboard'] },
      { id: 'about', labelKey: 'nav.about', resources: [] },
      { id: 'governance-map', labelKey: 'nav.designSystem', resources: ['design_system'] },
      { id: 'global-search', labelKey: 'roles.permissions.screen.globalSearch', resources: ['search'] },
    ],
  },
  {
    labelKey: 'roles.permissions.group.governance',
    screens: [
      { id: 'governance-home', labelKey: 'nav.section.governance', resources: [] },
      { id: 'data-assets', labelKey: 'nav.dataAssets', resources: ['data_assets'] },
      { id: 'ownership', labelKey: 'nav.ownership', resources: ['assignments'] },
      { id: 'assignment-rules', labelKey: 'nav.assignmentRules', resources: ['assignment_rules'] },
      { id: 'exceptions', labelKey: 'nav.exceptions', resources: ['assignments'] },
      { id: 'workflow', labelKey: 'nav.workflow', resources: ['workflow_tasks', 'workflow_cases'] },
      { id: 'workflow-designer', labelKey: 'nav.workflowDesigner', resources: ['workflow_cases'] },
      {
        id: 'data-quality',
        labelKey: 'nav.dataQuality',
        resources: ['data_quality_issues', 'data_quality_rules', 'data_quality_profiles'],
      },
      {
        id: 'security-governance',
        labelKey: 'nav.securityGovernance',
        resources: [
          'security_governance',
          'masking_policies',
          'role_data_access_maps',
          'access_reviews',
          'dlp_incidents',
          'classification_change_requests',
        ],
      },
      { id: 'open-data', labelKey: 'nav.openData', resources: ['open_data_candidates'] },
      {
        id: 'foi',
        labelKey: 'nav.foi',
        resources: ['foi_requests', 'foi_disclosures', 'foi_appeals'],
      },
      {
        id: 'privacy',
        labelKey: 'nav.privacyOperations',
        resources: [
          'privacy_operations',
          'privacy_legal_bases',
          'privacy_ropa_records',
          'privacy_dpias',
          'privacy_dsr_requests',
          'privacy_breaches',
        ],
      },
      {
        id: 'data-sharing',
        labelKey: 'nav.dataSharing',
        resources: ['data_sharing_requests', 'data_sharing_agreements'],
      },
      { id: 'transparency', labelKey: 'nav.transparencyCockpit', resources: ['dashboard'] },
      { id: 'reports', labelKey: 'nav.reports', resources: ['dashboard'] },
      {
        id: 'ndi-compliance',
        labelKey: 'nav.ndi',
        resources: ['ndi_specifications', 'evidence'],
      },
      { id: 'ndi-readiness', labelKey: 'nav.ndiReadiness', resources: ['ndi_scoring'] },
      { id: 'ndi-gaps', labelKey: 'nav.ndiGaps', resources: ['ndi_scoring'] },
      { id: 'ndi-audit-packs', labelKey: 'nav.auditPacks', resources: ['ndi_audit_packs'] },
      { id: 'extended-domains', labelKey: 'nav.extendedDomains', resources: ['extended_domains'] },
      { id: 'business-value', labelKey: 'nav.businessValue', resources: ['business_value'] },
      {
        id: 'governance-operations',
        labelKey: 'nav.governanceOperations',
        resources: ['governance_operations'],
      },
      {
        id: 'training',
        labelKey: 'nav.training',
        resources: [
          'training_courses',
          'training_requirements',
          'training_assignments',
          'certification_tracks',
          'certification_attempts',
          'ce_activities',
          'community_articles',
          'expert_profiles',
          'mentorship_pairs',
        ],
      },
    ],
  },
  {
    labelKey: 'roles.permissions.group.access',
    screens: [
      { id: 'access-home', labelKey: 'nav.section.accessManagement', resources: [] },
      { id: 'access-grants', labelKey: 'nav.accessGrants', resources: ['access_grants'] },
      { id: 'roles', labelKey: 'nav.roles', resources: ['roles'] },
      { id: 'users', labelKey: 'nav.users', resources: ['users'] },
      { id: 'audit', labelKey: 'nav.audit', resources: ['audit'] },
    ],
  },
  {
    labelKey: 'roles.permissions.group.administration',
    screens: [
      { id: 'administration-home', labelKey: 'nav.section.administration', resources: [] },
      { id: 'people', labelKey: 'nav.people', resources: ['people'] },
      { id: 'data-domains', labelKey: 'nav.dataDomains', resources: ['data_domains'] },
      { id: 'data-subjects', labelKey: 'nav.dataSubjects', resources: ['data_subjects'] },
      {
        id: 'business-capabilities',
        labelKey: 'nav.capabilities',
        resources: ['business_capabilities'],
      },
      { id: 'organization-units', labelKey: 'nav.orgUnits', resources: ['org_units'] },
      { id: 'systems', labelKey: 'nav.systems', resources: ['systems'] },
      { id: 'integrations', labelKey: 'nav.integrations', resources: ['integrations'] },
      { id: 'classifications', labelKey: 'nav.classifications', resources: ['classifications'] },
      { id: 'role-types', labelKey: 'nav.roleTypes', resources: ['role_types'] },
      { id: 'raci-templates', labelKey: 'nav.raci', resources: ['raci_templates'] },
      { id: 'status-values', labelKey: 'nav.statusValues', resources: ['status_values'] },
    ],
  },
];

const RESOURCE_ORDER = [
  ...new Set(
    PERMISSION_SCREEN_GROUPS.flatMap((group) =>
      group.screens.flatMap((screen) => screen.resources),
    ),
  ),
];

const SHARED_RESOURCES = new Set(
  RESOURCE_ORDER.filter(
    (resource) =>
      PERMISSION_SCREEN_GROUPS.flatMap((group) => group.screens).filter((screen) =>
        screen.resources.includes(resource),
      ).length > 1,
  ),
);

@Component({
  selector: 'app-roles',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule, Modal, StatusChip, AppIcon, MultiSelectModule],
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
  protected readonly typeFilters = signal<RoleTypeFilter[]>([]);
  protected readonly roleStatusFilters = signal<RoleStatusFilter[]>([]);
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
    const types = this.typeFilters();
    const statuses = this.roleStatusFilters();

    return this.roles().filter((role) => {
      const matchesQuery =
        !query ||
        role.code.toLowerCase().includes(query) ||
        role.nameEn.toLowerCase().includes(query) ||
        role.nameAr.toLowerCase().includes(query);
      const matchesType = !types.length || types.includes(role.isSystem ? 'system' : 'custom');
      const matchesStatus =
        !statuses.length || statuses.includes(role.isActive ? 'active' : 'inactive');
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
    const ordered = [...byRes.keys()].sort((a, b) => idx(a) - idx(b) || a.localeCompare(b));
    return ordered.map((resource) => ({ resource, actions: byRes.get(resource)! }));
    function idx(resource: string): number {
      const i = RESOURCE_ORDER.indexOf(resource);
      return i === -1 ? 999 : i;
    }
  });

  protected readonly permissionGroups = computed<PermissionGroup[]>(() => {
    const rows = this.resourceRows();
    const byResource = new Map(rows.map((row) => [row.resource, row]));
    const used = new Set<string>();
    const groups: PermissionGroup[] = PERMISSION_SCREEN_GROUPS.map((group) => ({
      labelKey: group.labelKey,
      screens: group.screens.map((screen) => {
        const screenRows = screen.resources
          .map((resource) => byResource.get(resource))
          .filter((row): row is PermissionResourceRow => Boolean(row));
        for (const row of screenRows) used.add(row.resource);
        return { ...screen, rows: screenRows };
      }),
    }));

    const otherRows = rows.filter((row) => !used.has(row.resource));
    if (otherRows.length) {
      groups.push({
        labelKey: 'roles.permissions.group.other',
        screens: otherRows.map((row) => ({
          id: `other-${row.resource}`,
          labelKey: `res.${row.resource}`,
          resources: [row.resource],
          rows: [row],
        })),
      });
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
            : (result.roles[0]?.id ?? null);
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

  protected roleTypeOptions() {
    return [
      { label: this.t('roles.system'), value: 'system' as const },
      { label: this.t('roles.custom'), value: 'custom' as const },
    ];
  }

  protected roleStatusOptions() {
    return [
      { label: this.t('crud.active'), value: 'active' as const },
      { label: this.t('crud.inactive'), value: 'inactive' as const },
    ];
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
    this.typeFilters.set([]);
    this.roleStatusFilters.set([]);
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

  protected actionsFor(actions: Set<string>): string[] {
    return [...actions].sort((a, b) => actionIndex(a) - actionIndex(b) || a.localeCompare(b));

    function actionIndex(action: string): number {
      const index = ACTION_ORDER.indexOf(action);
      return index === -1 ? 999 : index;
    }
  }

  protected screenPermissionCount(screen: PermissionScreen): number {
    return this.screenPermissionKeys(screen).length;
  }

  protected screenSelectedCount(screen: PermissionScreen): number {
    return this.screenPermissionKeys(screen).filter((key) => this.permSel().has(key)).length;
  }

  protected screenAllSelected(screen: PermissionScreen): boolean {
    const keys = this.screenPermissionKeys(screen);
    return keys.length > 0 && keys.every((key) => this.permSel().has(key));
  }

  protected screenSomeSelected(screen: PermissionScreen): boolean {
    const selected = this.screenSelectedCount(screen);
    return selected > 0 && selected < this.screenPermissionCount(screen);
  }

  protected screenHasSharedPermissions(screen: PermissionScreen): boolean {
    return screen.resources.some((resource) => SHARED_RESOURCES.has(resource));
  }

  protected toggleScreenAll(screen: PermissionScreen): void {
    const keys = this.screenPermissionKeys(screen);
    const allOn = keys.length > 0 && keys.every((key) => this.permSel().has(key));
    const next = new Set(this.permSel());
    for (const key of keys) {
      if (allOn) next.delete(key);
      else next.add(key);
    }
    this.permSel.set(next);
  }

  private screenPermissionKeys(screen: PermissionScreen): string[] {
    return screen.rows.flatMap((row) =>
      [...row.actions].map((action) => this.permKey(row.resource, action)),
    );
  }

  protected resourceSelectedCount(resource: string, actions: Set<string>): number {
    return [...actions].filter((action) => this.hasPerm(resource, action)).length;
  }

  protected resourceAllSelected(resource: string, actions: Set<string>): boolean {
    return [...actions].every((action) => this.hasPerm(resource, action));
  }

  protected resourceSomeSelected(resource: string, actions: Set<string>): boolean {
    return (
      !this.resourceAllSelected(resource, actions) &&
      this.resourceSelectedCount(resource, actions) > 0
    );
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
      error: (err) => {
        this.saving.set(false);
        this.formError.set(true);
        this.toast.errorFrom(err, this.t('crud.saveError'));
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
        error: (err) => {
          this.saving.set(false);
          this.toast.errorFrom(err, this.t('crud.saveError'));
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
        error: (err) => {
          this.saving.set(false);
          this.toast.errorFrom(err, this.t('crud.saveError'));
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
      error: (err) => this.toast.errorFrom(err, this.t('crud.deleteError')),
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
      error: (err) => this.toast.errorFrom(err, this.t('crud.loadError')),
    });
  }
}
