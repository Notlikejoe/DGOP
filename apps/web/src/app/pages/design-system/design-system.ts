import { ChangeDetectionStrategy, Component, OnDestroy, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { HttpClient, HttpParams } from '@angular/common/http';
import { RouterLink } from '@angular/router';
import { I18nService } from '../../core/i18n.service';
import { StatusChip } from '../../shared/status-chip';
import { NAV_SECTIONS, NavItem, NavSectionId } from '../../layout/navigation';

interface ConsoleMetric {
  labelKey: string;
  value: string;
  hintKey: string;
  tone: 'success' | 'warning' | 'danger' | 'info';
}

interface DesignTree {
  titleKey: string;
  subtitleKey: string;
  rootKey: string;
  groups: {
    titleKey: string;
    summaryKey: string;
    items: NavItem[];
  }[];
}

interface RuleCard {
  titleKey: string;
  bodyKey: string;
  tone: 'success' | 'warning' | 'danger' | 'info';
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

interface GlobalSearchResponse {
  query: string;
  total: number;
  groups: SearchGroup[];
}

@Component({
  selector: 'app-design-system',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule, RouterLink, StatusChip],
  templateUrl: './design-system.html',
  styleUrl: './design-system.scss',
})
export class DesignSystem implements OnDestroy {
  private readonly http = inject(HttpClient);
  protected readonly i18n = inject(I18nService);
  protected readonly activeTreeIndex = signal(0);
  protected readonly searchQuery = signal('');
  protected readonly searchState = signal<'idle' | 'typing' | 'loading' | 'ok' | 'error'>('idle');
  protected readonly searchResponse = signal<GlobalSearchResponse | null>(null);
  private searchTimer: ReturnType<typeof setTimeout> | null = null;
  private searchRequestId = 0;

  protected readonly metrics: ConsoleMetric[] = [
    {
      labelKey: 'ds.console.metric.health',
      value: '91%',
      hintKey: 'ds.console.metric.healthHint',
      tone: 'success',
    },
    {
      labelKey: 'ds.console.metric.alerts',
      value: '7',
      hintKey: 'ds.console.metric.alertsHint',
      tone: 'warning',
    },
    {
      labelKey: 'ds.console.metric.privacy',
      value: '1',
      hintKey: 'ds.console.metric.privacyHint',
      tone: 'danger',
    },
    {
      labelKey: 'ds.console.metric.audit',
      value: '84%',
      hintKey: 'ds.console.metric.auditHint',
      tone: 'warning',
    },
  ];

  protected readonly trees: DesignTree[] = [
    {
      titleKey: 'ds.tree.governance.title',
      subtitleKey: 'ds.tree.governance.subtitle',
      rootKey: 'nav.section.governance',
      groups: this.groupsFor(['governance']),
    },
    {
      titleKey: 'ds.tree.admin.title',
      subtitleKey: 'ds.tree.admin.subtitle',
      rootKey: 'nav.section.administration',
      groups: this.groupsFor(['accessManagement', 'administration']),
    },
  ];

  protected readonly rules: RuleCard[] = [
    {
      titleKey: 'ds.rule.plainLanguage.title',
      bodyKey: 'ds.rule.plainLanguage.body',
      tone: 'success',
    },
    {
      titleKey: 'ds.rule.progressive.title',
      bodyKey: 'ds.rule.progressive.body',
      tone: 'info',
    },
    {
      titleKey: 'ds.rule.safety.title',
      bodyKey: 'ds.rule.safety.body',
      tone: 'warning',
    },
  ];

  protected t(key: string): string {
    return this.i18n.t(key);
  }

  protected showTree(index: number): void {
    this.activeTreeIndex.set(index);
  }

  protected onSearchInput(value: string): void {
    this.searchQuery.set(value);
    this.searchResponse.set(null);
    if (this.searchTimer) clearTimeout(this.searchTimer);
    const query = value.trim();
    if (query.length < 2) {
      this.searchState.set('idle');
      return;
    }
    this.searchState.set('typing');
    this.searchTimer = setTimeout(() => this.runSearch(query), 250);
  }

  protected clearSearch(): void {
    if (this.searchTimer) clearTimeout(this.searchTimer);
    this.searchQuery.set('');
    this.searchResponse.set(null);
    this.searchState.set('idle');
  }

  protected groupLabel(type: string): string {
    return this.t(`search.group.${type}`);
  }

  ngOnDestroy(): void {
    if (this.searchTimer) clearTimeout(this.searchTimer);
  }

  private runSearch(query: string): void {
    const requestId = ++this.searchRequestId;
    this.searchState.set('loading');
    const params = new HttpParams().set('q', query).set('limit', '5');
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

  private groupsFor(sectionIds: NavSectionId[]): DesignTree['groups'] {
    const items = sectionIds.flatMap(
      (id) => NAV_SECTIONS.find((section) => section.id === id)?.items ?? [],
    );
    const groups: DesignTree['groups'] = [];
    for (const item of items) {
      const key = item.groupKey ?? 'hub.group.other';
      const group = groups.find((candidate) => candidate.titleKey === `${key}.title`);
      if (group) {
        group.items.push(item);
      } else {
        groups.push({
          titleKey: `${key}.title`,
          summaryKey: `${key}.summary`,
          items: [item],
        });
      }
    }
    return groups;
  }
}
