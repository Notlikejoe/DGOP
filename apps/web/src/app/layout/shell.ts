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
import { CRUMB_MAP, NAV_SECTIONS, NavItem, NavSection } from './navigation';
import { AppIcon } from '../shared/app-icon';

@Component({
  selector: 'app-shell',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterOutlet, RouterLink, RouterLinkActive, AppIcon],
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
  protected readonly mobileNavOpen = signal(false);
  protected readonly openTasks = signal(0);
  protected readonly expandedSections = signal<Record<string, boolean>>({});

  protected readonly sections = computed<NavSection[]>(() =>
    NAV_SECTIONS.map((section) => ({
      ...section,
      items: section.items.filter((item) => this.canSeeNavItem(item)),
    })).filter((section) => section.items.length > 0),
  );

  protected readonly crumbKey = computed(() => {
    const u = this.url();
    const match = Object.keys(CRUMB_MAP)
      .sort((a, b) => b.length - a.length)
      .find((key) => u.startsWith(key));
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
        this.mobileNavOpen.set(false);
        this.refreshOpenTasks();
      });
    this.refreshOpenTasks();
  }

  /** Loads the count of the user's open workflow tasks for the inbox badge. */
  private refreshOpenTasks(): void {
    if (!this.auth.hasPermission('workflow_tasks.view')) return;
    this.http.get<unknown[]>('/api/workflow/tasks/mine?status=open').subscribe({
      next: (tasks) => this.openTasks.set(tasks.length),
      error: () => {},
    });
  }

  protected t(key: string): string {
    return this.i18n.t(key);
  }

  private canSeeNavItem(item: NavItem): boolean {
    return !item.permission || this.auth.hasPermission(item.permission);
  }

  protected isWorkspaceSection(section: NavSection): boolean {
    return !!section.homeLink && !!section.summaryKey;
  }

  protected isSectionActive(section: NavSection): boolean {
    const u = this.url();
    return (
      (!!section.homeLink && (u === section.homeLink || u.startsWith(`${section.homeLink}/`))) ||
      section.items.some((item) => u === item.link || u.startsWith(`${item.link}/`))
    );
  }

  protected isSectionOpen(section: NavSection): boolean {
    if (!this.isWorkspaceSection(section)) return true;
    const explicit = this.expandedSections()[section.id];
    return explicit ?? this.isSectionActive(section);
  }

  protected toggleSection(section: NavSection): void {
    const next = !this.isSectionOpen(section);
    this.expandedSections.update((sections) => ({ ...sections, [section.id]: next }));
  }

  protected closeMobileNav(): void {
    this.mobileNavOpen.set(false);
  }

  protected sectionToggleLabel(section: NavSection): string {
    const key = this.isSectionOpen(section) ? 'nav.collapseSection' : 'nav.expandSection';
    return `${this.t(key)} ${this.t(section.titleKey)}`;
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
