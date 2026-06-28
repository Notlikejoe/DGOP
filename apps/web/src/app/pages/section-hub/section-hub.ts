import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { AuthService } from '../../core/auth.service';
import { I18nService } from '../../core/i18n.service';
import {
  HUB_CONFIGS,
  HubConfig,
  HubId,
  NAV_SECTIONS,
  NavItem,
} from '../../layout/navigation';

interface HubGroup {
  key: string;
  items: NavItem[];
}

interface HubMetric {
  labelKey: string;
  value: string;
  hintKey: string;
  tone: 'success' | 'warning' | 'danger' | 'info';
}

interface QueueItem {
  titleKey: string;
  metaKey: string;
  actionKey: string;
  link: string;
  tone: 'success' | 'warning' | 'danger' | 'info';
}

@Component({
  selector: 'app-section-hub',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink],
  templateUrl: './section-hub.html',
  styleUrl: './section-hub.scss',
})
export class SectionHubPage {
  private readonly route = inject(ActivatedRoute);
  private readonly auth = inject(AuthService);
  protected readonly i18n = inject(I18nService);

  protected readonly config = computed<HubConfig>(() => {
    const hubId = this.route.snapshot.data['hubId'] as HubId | undefined;
    return HUB_CONFIGS.find((hub) => hub.id === hubId) ?? HUB_CONFIGS[0];
  });

  protected readonly items = computed<NavItem[]>(() =>
    this.config()
      .sectionIds.flatMap((sectionId) => NAV_SECTIONS.find((section) => section.id === sectionId)?.items ?? [])
      .filter((item) => !item.permission || this.auth.hasPermission(item.permission)),
  );

  protected readonly featuredItems = computed<NavItem[]>(() => {
    const featured = this.items().filter((item) => item.featured);
    return (featured.length > 0 ? featured : this.items()).slice(0, 4);
  });

  protected readonly groups = computed<HubGroup[]>(() => {
    const groups: HubGroup[] = [];
    for (const item of this.items()) {
      const key = item.groupKey ?? 'hub.group.other';
      const existing = groups.find((group) => group.key === key);
      if (existing) {
        existing.items.push(item);
      } else {
        groups.push({ key, items: [item] });
      }
    }
    return groups;
  });

  protected readonly toolCount = computed(() => this.items().length);
  protected readonly groupCount = computed(() => this.groups().length);

  protected readonly metrics = computed<HubMetric[]>(() => {
    if (this.config().id === 'governance') {
      return [
        {
          labelKey: 'console.metric.governanceHealth',
          value: '91%',
          hintKey: 'console.metric.governanceHealthHint',
          tone: 'success',
        },
        {
          labelKey: 'console.metric.openAlerts',
          value: '7',
          hintKey: 'console.metric.openAlertsHint',
          tone: 'warning',
        },
        {
          labelKey: 'console.metric.privacyRisk',
          value: '1',
          hintKey: 'console.metric.privacyRiskHint',
          tone: 'danger',
        },
        {
          labelKey: 'console.metric.auditReady',
          value: '84%',
          hintKey: 'console.metric.auditReadyHint',
          tone: 'warning',
        },
      ];
    }

    return [
      {
        labelKey: 'console.metric.accessCoverage',
        value: '98%',
        hintKey: 'console.metric.accessCoverageHint',
        tone: 'success',
      },
      {
        labelKey: 'console.metric.pendingAccess',
        value: '3',
        hintKey: 'console.metric.pendingAccessHint',
        tone: 'warning',
      },
      {
        labelKey: 'console.metric.referenceSets',
        value: String(this.toolCount()),
        hintKey: 'console.metric.referenceSetsHint',
        tone: 'info',
      },
      {
        labelKey: 'console.metric.auditTrail',
        value: '100%',
        hintKey: 'console.metric.auditTrailHint',
        tone: 'success',
      },
    ];
  });

  protected readonly queue = computed<QueueItem[]>(() => {
    if (this.config().id === 'governance') {
      return [
        {
          titleKey: 'console.queue.assignOwner',
          metaKey: 'console.queue.assignOwnerMeta',
          actionKey: 'console.queue.assignOwnerAction',
          link: '/governance/exception-queue',
          tone: 'warning',
        },
        {
          titleKey: 'console.queue.reviewEvidence',
          metaKey: 'console.queue.reviewEvidenceMeta',
          actionKey: 'console.queue.reviewEvidenceAction',
          link: '/governance/ndi/gaps',
          tone: 'danger',
        },
      ];
    }

    return [
      {
        titleKey: 'console.queue.reviewAccess',
        metaKey: 'console.queue.reviewAccessMeta',
        actionKey: 'console.queue.reviewAccessAction',
        link: '/admin/users',
        tone: 'warning',
      },
      {
        titleKey: 'console.queue.completeDirectory',
        metaKey: 'console.queue.completeDirectoryMeta',
        actionKey: 'console.queue.completeDirectoryAction',
        link: '/admin/people',
        tone: 'info',
      },
    ];
  });

  protected t(key: string): string {
    return this.i18n.t(key);
  }
}
