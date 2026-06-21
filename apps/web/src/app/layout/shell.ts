import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import {
  NavigationEnd,
  Router,
  RouterLink,
  RouterLinkActive,
  RouterOutlet,
} from '@angular/router';
import { HttpClient } from '@angular/common/http';
import { filter } from 'rxjs';
import { AuthService } from '../core/auth.service';
import { I18nService } from '../core/i18n.service';
import { ThemeService } from '../core/theme.service';

interface NavItem {
  labelKey: string;
  icon: string;
  link: string;
  permission: string;
  /** When true, the shell shows the user's open-task count as a badge. */
  badge?: boolean;
}
interface NavSection {
  titleKey: string;
  items: NavItem[];
}

const NAV: NavSection[] = [
  {
    titleKey: 'nav.section.overview',
    items: [{ labelKey: 'nav.dashboard', icon: '▦', link: '/dashboard', permission: 'dashboard.view' }],
  },
  {
    titleKey: 'nav.section.foundation',
    items: [
      { labelKey: 'nav.designSystem', icon: '◑', link: '/design-system', permission: 'design_system.view' },
    ],
  },
  {
    titleKey: 'nav.section.governance',
    items: [
      { labelKey: 'nav.dataAssets', icon: '▢', link: '/assets', permission: 'data_assets.view' },
      { labelKey: 'nav.ownership', icon: '◈', link: '/governance/ownership', permission: 'assignments.view' },
      { labelKey: 'nav.assignmentRules', icon: '⚖', link: '/governance/assignment-rules', permission: 'assignment_rules.view' },
      { labelKey: 'nav.exceptions', icon: '⚑', link: '/governance/exception-queue', permission: 'assignments.view' },
      { labelKey: 'nav.workflow', icon: '◴', link: '/governance/workflow', permission: 'workflow_tasks.view', badge: true },
      { labelKey: 'nav.ndi', icon: '◉', link: '/governance/ndi', permission: 'ndi_specifications.view' },
      { labelKey: 'nav.ndiReadiness', icon: '◍', link: '/governance/ndi/readiness', permission: 'ndi_scoring.view' },
      { labelKey: 'nav.ndiGaps', icon: '⚠', link: '/governance/ndi/gaps', permission: 'ndi_scoring.view' },
    ],
  },
  {
    titleKey: 'nav.section.accessManagement',
    items: [
      { labelKey: 'nav.roles', icon: '✷', link: '/admin/roles', permission: 'roles.view' },
      { labelKey: 'nav.users', icon: '⚙', link: '/admin/users', permission: 'users.view' },
      { labelKey: 'nav.audit', icon: '❒', link: '/admin/audit', permission: 'audit.view' },
    ],
  },
  {
    titleKey: 'nav.section.administration',
    items: [
      { labelKey: 'nav.people', icon: '☺', link: '/admin/people', permission: 'people.view' },
      { labelKey: 'nav.dataDomains', icon: '◧', link: '/admin/data-domains', permission: 'data_domains.view' },
      { labelKey: 'nav.dataSubjects', icon: '◎', link: '/admin/data-subjects', permission: 'data_subjects.view' },
      { labelKey: 'nav.capabilities', icon: '▦', link: '/admin/capabilities', permission: 'business_capabilities.view' },
      { labelKey: 'nav.orgUnits', icon: '⌂', link: '/admin/org-units', permission: 'org_units.view' },
      { labelKey: 'nav.systems', icon: '▤', link: '/admin/systems', permission: 'systems.view' },
      { labelKey: 'nav.classifications', icon: '◆', link: '/admin/classifications', permission: 'classifications.view' },
      { labelKey: 'nav.roleTypes', icon: '✦', link: '/admin/role-types', permission: 'role_types.view' },
      { labelKey: 'nav.raci', icon: '▥', link: '/admin/raci-templates', permission: 'raci_templates.view' },
      { labelKey: 'nav.statusValues', icon: '◔', link: '/admin/status-values', permission: 'status_values.view' },
    ],
  },
];

const CRUMB_MAP: Record<string, string> = {
  '/dashboard': 'nav.dashboard',
  '/design-system': 'nav.designSystem',
  '/assets': 'nav.dataAssets',
  '/governance/ownership': 'nav.ownership',
  '/governance/assignment-rules': 'nav.assignmentRules',
  '/governance/exception-queue': 'nav.exceptions',
  '/governance/workflow': 'nav.workflow',
  '/governance/ndi/readiness': 'nav.ndiReadiness',
  '/governance/ndi/gaps': 'nav.ndiGaps',
  '/governance/ndi': 'nav.ndi',
  '/admin/people': 'nav.people',
  '/admin/roles': 'nav.roles',
  '/admin/users': 'nav.users',
  '/admin/audit': 'nav.audit',
  '/admin/data-domains': 'nav.dataDomains',
  '/admin/data-subjects': 'nav.dataSubjects',
  '/admin/capabilities': 'nav.capabilities',
  '/admin/org-units': 'nav.orgUnits',
  '/admin/systems': 'nav.systems',
  '/admin/classifications': 'nav.classifications',
  '/admin/role-types': 'nav.roleTypes',
  '/admin/raci-templates': 'nav.raci',
  '/admin/status-values': 'nav.statusValues',
};

@Component({
  selector: 'app-shell',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterOutlet, RouterLink, RouterLinkActive],
  templateUrl: './shell.html',
  styleUrl: './shell.scss',
})
export class Shell {
  protected readonly theme = inject(ThemeService);
  protected readonly i18n = inject(I18nService);
  protected readonly auth = inject(AuthService);
  private readonly router = inject(Router);
  private readonly http = inject(HttpClient);

  private readonly url = signal(this.router.url);
  protected readonly menuOpen = signal(false);
  protected readonly openTasks = signal(0);

  protected readonly sections = computed<NavSection[]>(() =>
    NAV.map((s) => ({ ...s, items: s.items.filter((i) => this.auth.hasPermission(i.permission)) })).filter(
      (s) => s.items.length > 0,
    ),
  );

  protected readonly crumbKey = computed(() => {
    const u = this.url();
    const match = Object.keys(CRUMB_MAP).find((k) => u.startsWith(k));
    return match ? CRUMB_MAP[match] : '';
  });

  protected readonly primaryRole = computed(() => {
    const roles = this.auth.currentUser()?.roles ?? [];
    if (roles.length === 0) return '';
    return this.i18n.lang() === 'ar' ? roles[0].nameAr : roles[0].nameEn;
  });

  constructor() {
    this.router.events
      .pipe(
        filter((e): e is NavigationEnd => e instanceof NavigationEnd),
        takeUntilDestroyed(),
      )
      .subscribe((e) => {
        this.url.set(e.urlAfterRedirects);
        this.menuOpen.set(false);
        this.refreshOpenTasks();
      });
    this.refreshOpenTasks();
  }

  /** Loads the count of the user's open workflow tasks for the inbox badge. */
  private refreshOpenTasks(): void {
    if (!this.auth.hasPermission('workflow_tasks.view')) return;
    this.http
      .get<unknown[]>('/api/workflow/tasks/mine?status=open')
      .subscribe({
        next: (tasks) => this.openTasks.set(tasks.length),
        error: () => {},
      });
  }

  protected t(key: string): string {
    return this.i18n.t(key);
  }

  protected initials(): string {
    const name = this.auth.currentUser()?.displayName ?? '';
    return name
      .split(' ')
      .map((p) => p[0])
      .filter(Boolean)
      .slice(0, 2)
      .join('')
      .toUpperCase();
  }

  protected logout(): void {
    void this.auth.logout();
  }
}
