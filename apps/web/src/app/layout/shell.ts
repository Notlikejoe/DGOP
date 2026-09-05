import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  HostListener,
  OnDestroy,
  ViewChild,
  computed,
  inject,
  signal,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { NavigationEnd, Router, RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { HttpClient, HttpParams } from '@angular/common/http';
import { filter } from 'rxjs';
import { AuthService } from '../core/auth.service';
import { I18nService } from '../core/i18n.service';
import { ThemeService } from '../core/theme.service';
import { CRUMB_MAP, NAV_SECTIONS, NavItem, NavSection } from './navigation';
import { AppIcon } from '../shared/app-icon';

const SIDEBAR_DEFAULT_WIDTH = 264;
const SIDEBAR_MIN_WIDTH = 236;
const SIDEBAR_MAX_WIDTH = 420;
const SIDEBAR_KEYBOARD_STEP = 16;
const SIDEBAR_WIDTH_STORAGE_KEY = 'dgop.sidebar.width';

interface PagedResponse<T> {
  data: T[];
  total: number;
}

interface SearchRoute {
  path: string;
  queryParams?: Record<string, string>;
}

interface SearchResult {
  id: string;
  entityType: string;
  title: string;
  subtitle?: string | null;
  detail?: string | null;
  status?: string | null;
  route: SearchRoute;
}

interface SearchGroup {
  type: string;
  count: number;
  results: SearchResult[];
}

interface SearchFacetValue {
  value: string;
  count: number;
}

interface SearchFacet {
  key: string;
  values: SearchFacetValue[];
}

interface GlobalSearchResponse {
  query: string;
  total: number;
  groups: SearchGroup[];
  facets?: SearchFacet[];
}

@Component({
  selector: 'app-shell',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterOutlet, RouterLink, RouterLinkActive, AppIcon],
  templateUrl: './shell.html',
  styleUrl: './shell.scss',
})
export class Shell implements OnDestroy {
  @ViewChild('sidebar') private readonly sidebar?: ElementRef<HTMLElement>;
  @ViewChild('navToggle') private readonly navToggle?: ElementRef<HTMLButtonElement>;

  protected readonly theme = inject(ThemeService);
  protected readonly i18n = inject(I18nService);
  protected readonly auth = inject(AuthService);
  private readonly router = inject(Router);
  private readonly http = inject(HttpClient);

  private readonly url = signal(this.router.url);
  protected readonly menuOpen = signal(false);
  protected readonly mobileNavOpen = signal(false);
  protected readonly compactNav = signal(false);
  protected readonly sidebarWidth = signal(this.readStoredSidebarWidth());
  protected readonly sidebarResizing = signal(false);
  protected readonly openTasks = signal(0);
  protected readonly expandedSections = signal<Record<string, boolean>>({});
  protected readonly navQuery = signal('');
  protected readonly searchQuery = signal('');
  protected readonly searchState = signal<'idle' | 'typing' | 'loading' | 'ok' | 'error'>('idle');
  protected readonly searchResponse = signal<GlobalSearchResponse | null>(null);
  protected readonly searchFocused = signal(false);
  private searchTimer: ReturnType<typeof setTimeout> | null = null;
  private searchRequestId = 0;
  private resizePointerId: number | null = null;
  private resizeStartX = 0;
  private resizeStartWidth = SIDEBAR_DEFAULT_WIDTH;
  private readonly compactQuery =
    typeof window === 'undefined' ? null : window.matchMedia('(max-width: 1120px)');

  protected readonly sections = computed<NavSection[]>(() =>
    NAV_SECTIONS.map((section) => ({
      ...section,
      items: section.items.filter((item) => this.canSeeNavItem(item)),
    })).filter((section) => section.items.length > 0),
  );

  protected readonly visibleSections = computed<NavSection[]>(() => {
    const query = this.navQuery().trim().toLocaleLowerCase();
    if (!query) return this.sections();
    return this.sections()
      .map((section) => {
        const sectionMatches =
          `${this.t(section.titleKey)} ${section.summaryKey ? this.t(section.summaryKey) : ''}`
            .toLocaleLowerCase()
            .includes(query);
        const items = sectionMatches
          ? section.items
          : section.items.filter((item) =>
              `${this.t(item.labelKey)} ${this.t(item.descriptionKey)}`
                .toLocaleLowerCase()
                .includes(query),
            );
        return { ...section, items };
      })
      .filter((section) => section.items.length > 0);
  });

  protected readonly visibleNavigationItemCount = computed(() =>
    this.visibleSections().reduce((count, section) => count + section.items.length, 0),
  );

  protected readonly allWorkspaceSectionsOpen = computed(() => {
    const workspaces = this.visibleSections().filter((section) => this.isWorkspaceSection(section));
    return workspaces.length > 0 && workspaces.every((section) => this.isSectionOpen(section));
  });

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

  protected readonly showPrimaryRole = computed(() => {
    const role = this.primaryRole().trim().toLocaleLowerCase();
    const name = (this.auth.currentUser()?.displayName ?? '').trim().toLocaleLowerCase();
    return !!role && role !== name;
  });

  protected readonly sidebarHidden = computed(() => this.compactNav() && !this.mobileNavOpen());
  protected readonly canUseSearch = computed(() => this.auth.hasPermission('search.view'));
  protected readonly searchPanelOpen = computed(
    () =>
      this.canUseSearch() &&
      this.searchQuery().trim().length >= 2 &&
      (this.searchFocused() || this.searchState() === 'loading'),
  );

  constructor() {
    if (this.compactQuery) {
      this.compactNav.set(this.compactQuery.matches);
      this.compactQuery.addEventListener('change', (event) => {
        this.compactNav.set(event.matches);
        if (!event.matches) this.mobileNavOpen.set(false);
      });
    }
    this.router.events
      .pipe(
        filter((e): e is NavigationEnd => e instanceof NavigationEnd),
        takeUntilDestroyed(),
      )
      .subscribe((e) => {
        this.url.set(e.urlAfterRedirects);
        this.menuOpen.set(false);
        this.clearGlobalSearch();
        this.closeMobileNav();
        this.refreshOpenTasks();
      });
    this.refreshOpenTasks();
  }

  ngOnDestroy(): void {
    if (this.searchTimer) clearTimeout(this.searchTimer);
    this.stopSidebarResize();
  }

  protected startSidebarResize(event: PointerEvent): void {
    if (this.compactNav() || event.button !== 0) return;
    event.preventDefault();
    this.resizePointerId = event.pointerId;
    this.resizeStartX = event.clientX;
    this.resizeStartWidth = this.sidebarWidth();
    this.sidebarResizing.set(true);
    (event.currentTarget as HTMLElement | null)?.setPointerCapture?.(event.pointerId);
  }

  @HostListener('window:pointermove', ['$event'])
  protected continueSidebarResize(event: PointerEvent): void {
    if (!this.sidebarResizing() || event.pointerId !== this.resizePointerId) return;
    const direction = this.isRtl() ? -1 : 1;
    const width = this.resizeStartWidth + (event.clientX - this.resizeStartX) * direction;
    this.sidebarWidth.set(this.clampSidebarWidth(width));
  }

  @HostListener('window:pointerup', ['$event'])
  @HostListener('window:pointercancel', ['$event'])
  protected finishSidebarResize(event: PointerEvent): void {
    if (event.pointerId !== this.resizePointerId) return;
    this.stopSidebarResize();
    this.persistSidebarWidth();
  }

  protected resizeSidebarWithKeyboard(event: KeyboardEvent): void {
    let next: number | null = null;
    const direction = this.isRtl() ? -1 : 1;
    if (event.key === 'ArrowRight') {
      next = this.sidebarWidth() + SIDEBAR_KEYBOARD_STEP * direction;
    } else if (event.key === 'ArrowLeft') {
      next = this.sidebarWidth() - SIDEBAR_KEYBOARD_STEP * direction;
    } else if (event.key === 'Home') {
      next = SIDEBAR_MIN_WIDTH;
    } else if (event.key === 'End') {
      next = SIDEBAR_MAX_WIDTH;
    }
    if (next === null) return;
    event.preventDefault();
    this.sidebarWidth.set(this.clampSidebarWidth(next));
    this.persistSidebarWidth();
  }

  protected resetSidebarWidth(): void {
    this.sidebarWidth.set(SIDEBAR_DEFAULT_WIDTH);
    this.persistSidebarWidth();
  }

  private stopSidebarResize(): void {
    this.sidebarResizing.set(false);
    this.resizePointerId = null;
  }

  private readStoredSidebarWidth(): number {
    if (typeof window === 'undefined') return SIDEBAR_DEFAULT_WIDTH;
    try {
      const stored = Number(window.localStorage.getItem(SIDEBAR_WIDTH_STORAGE_KEY));
      return Number.isFinite(stored) && stored > 0
        ? this.clampSidebarWidth(stored)
        : SIDEBAR_DEFAULT_WIDTH;
    } catch {
      return SIDEBAR_DEFAULT_WIDTH;
    }
  }

  private persistSidebarWidth(): void {
    if (typeof window === 'undefined') return;
    try {
      window.localStorage.setItem(SIDEBAR_WIDTH_STORAGE_KEY, String(this.sidebarWidth()));
    } catch {
      // The layout still works when storage is unavailable.
    }
  }

  private clampSidebarWidth(width: number): number {
    return Math.min(SIDEBAR_MAX_WIDTH, Math.max(SIDEBAR_MIN_WIDTH, Math.round(width)));
  }

  private isRtl(): boolean {
    return typeof document !== 'undefined' && document.documentElement.dir === 'rtl';
  }

  /** Loads the count of the user's open workflow tasks for the inbox badge. */
  private refreshOpenTasks(): void {
    if (!this.auth.hasPermission('workflow_tasks.view')) return;
    this.http
      .get<PagedResponse<unknown>>('/api/workflow/tasks/mine', {
        params: { status: 'open', page: '1', pageSize: '1' },
      })
      .subscribe({
        next: (tasks) => this.openTasks.set(tasks.total),
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

  protected sectionGroups(section: NavSection): Array<{ key: string; items: NavItem[] }> {
    const groups = new Map<string, NavItem[]>();
    for (const item of section.items) {
      const key = item.groupKey ?? '';
      groups.set(key, [...(groups.get(key) ?? []), item]);
    }
    return [...groups.entries()].map(([key, items]) => ({ key, items }));
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
    if (this.navQuery().trim()) return true;
    const explicit = this.expandedSections()[section.id];
    return explicit ?? this.isSectionActive(section);
  }

  protected toggleSection(section: NavSection): void {
    const next = !this.isSectionOpen(section);
    this.expandedSections.update((sections) => ({ ...sections, [section.id]: next }));
  }

  protected clearNavigationSearch(): void {
    this.navQuery.set('');
  }

  protected toggleAllNavigationSections(): void {
    const open = !this.allWorkspaceSectionsOpen();
    const next = { ...this.expandedSections() };
    for (const section of this.sections()) {
      if (this.isWorkspaceSection(section)) next[section.id] = open;
    }
    this.expandedSections.set(next);
  }

  protected closeMobileNav(): void {
    this.moveFocusOutOfSidebar();
    this.mobileNavOpen.set(false);
  }

  protected openMobileNav(): void {
    this.mobileNavOpen.set(true);
  }

  private moveFocusOutOfSidebar(): void {
    if (typeof document === 'undefined') return;
    const sidebar = this.sidebar?.nativeElement;
    const active = document.activeElement;
    if (!sidebar || !(active instanceof HTMLElement) || !sidebar.contains(active)) return;
    this.navToggle?.nativeElement.focus({ preventScroll: true });
    if (sidebar.contains(document.activeElement)) {
      document.getElementById('main-content')?.focus({ preventScroll: true });
    }
  }

  protected sectionToggleLabel(section: NavSection): string {
    const key = this.isSectionOpen(section) ? 'nav.collapseSection' : 'nav.expandSection';
    return `${this.t(key)} ${this.t(section.titleKey)}`;
  }

  protected onGlobalSearchInput(value: string): void {
    this.searchQuery.set(value);
    this.searchResponse.set(null);
    if (this.searchTimer) {
      clearTimeout(this.searchTimer);
      this.searchTimer = null;
    }
    const query = value.trim();
    if (!this.canUseSearch() || query.length < 2) {
      this.searchRequestId += 1;
      this.searchState.set('idle');
      return;
    }
    this.searchState.set('typing');
    this.searchTimer = setTimeout(() => this.runGlobalSearch(query), 220);
  }

  protected clearGlobalSearch(): void {
    if (this.searchTimer) {
      clearTimeout(this.searchTimer);
      this.searchTimer = null;
    }
    this.searchRequestId += 1;
    this.searchQuery.set('');
    this.searchResponse.set(null);
    this.searchState.set('idle');
    this.searchFocused.set(false);
  }

  protected searchGroupLabel(type: string): string {
    return this.t(`search.group.${type}`);
  }

  protected searchFacetLabel(key: string): string {
    return this.t(`search.facet.${key}`);
  }

  protected applySearchFacet(key: string, value: string): void {
    const field = key === 'entityType' ? 'type' : key;
    const token = `${field}:${value}`;
    const query = this.searchQuery().trim();
    const next = query.includes(token) ? query : `${query} ${token}`.trim();
    this.onGlobalSearchInput(next);
  }

  protected recordSearchClick(result: SearchResult): void {
    this.http
      .post('/api/search/analytics/click', {
        query: this.searchQuery(),
        resultCount: this.searchResponse()?.total ?? 0,
        selectedEntityType: result.entityType,
        selectedEntityId: result.id,
        source: 'shell_global_search',
      })
      .subscribe({ error: () => {} });
    this.clearGlobalSearch();
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

  private runGlobalSearch(query: string): void {
    const requestId = ++this.searchRequestId;
    this.searchState.set('loading');
    const params = new HttpParams().set('q', query).set('limit', '6');
    this.http.get<GlobalSearchResponse>('/api/search', { params }).subscribe({
      next: (response) => {
        if (requestId !== this.searchRequestId) return;
        this.searchResponse.set(response);
        this.searchState.set('ok');
      },
      error: () => {
        if (requestId !== this.searchRequestId) return;
        this.searchResponse.set(null);
        this.searchState.set('error');
      },
    });
  }
}
