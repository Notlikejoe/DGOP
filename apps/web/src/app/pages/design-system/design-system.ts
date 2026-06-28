import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
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

@Component({
  selector: 'app-design-system',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink, StatusChip],
  templateUrl: './design-system.html',
  styleUrl: './design-system.scss',
})
export class DesignSystem {
  protected readonly i18n = inject(I18nService);
  protected readonly activeTreeIndex = signal(0);

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
