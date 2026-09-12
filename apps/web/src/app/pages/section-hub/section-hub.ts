import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { AuthService } from '../../core/auth.service';
import { I18nService } from '../../core/i18n.service';
import { AppIcon, AppIconName } from '../../shared/app-icon';
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
  icon: AppIconName;
}

interface QueueItem {
  titleKey: string;
  metaKey: string;
  actionKey: string;
  link: string;
  tone: 'success' | 'warning' | 'danger' | 'info';
  icon: AppIconName;
}

@Component({
  selector: 'app-section-hub',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink, AppIcon],
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
      .filter((item) => !item.permission || (typeof item.permission === 'string'
        ? this.auth.hasPermission(item.permission) : item.permission.some(value => this.auth.hasPermission(value)))),
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
  protected readonly hubIcon = computed<AppIconName>(() => {
    if (this.config().id === 'governance') return 'shield';
    if (this.config().id === 'accessManagement') return 'keyRound';
    return 'settings';
  });

  protected readonly metrics = computed<HubMetric[]>(() => {
    if (this.config().id === 'governance') {
      return [
        {
          labelKey: 'console.metric.governanceHealth',
          value: '91%',
          hintKey: 'console.metric.governanceHealthHint',
          tone: 'success',
          icon: 'gauge',
        },
        {
          labelKey: 'console.metric.openAlerts',
          value: '7',
          hintKey: 'console.metric.openAlertsHint',
          tone: 'warning',
          icon: 'alert',
        },
        {
          labelKey: 'console.metric.privacyRisk',
          value: '1',
          hintKey: 'console.metric.privacyRiskHint',
          tone: 'danger',
          icon: 'shield',
        },
        {
          labelKey: 'console.metric.auditReady',
          value: '84%',
          hintKey: 'console.metric.auditReadyHint',
          tone: 'warning',
          icon: 'scrollText',
        },
      ];
    }

    if (this.config().id === 'accessManagement') {
      return [
        {
          labelKey: 'console.metric.accessCoverage',
          value: '98%',
          hintKey: 'console.metric.accessCoverageHint',
          tone: 'success',
          icon: 'userCheck',
        },
        {
          labelKey: 'console.metric.pendingAccess',
          value: '3',
          hintKey: 'console.metric.pendingAccessHint',
          tone: 'warning',
          icon: 'keyRound',
        },
        {
          labelKey: 'console.metric.accessTools',
          value: String(this.toolCount()),
          hintKey: 'console.metric.accessToolsHint',
          tone: 'info',
          icon: 'shield',
        },
        {
          labelKey: 'console.metric.auditTrail',
          value: '100%',
          hintKey: 'console.metric.auditTrailHint',
          tone: 'success',
          icon: 'scrollText',
        },
      ];
    }

    return [
      {
        labelKey: 'console.metric.directoryCoverage',
        value: '92%',
        hintKey: 'console.metric.directoryCoverageHint',
        tone: 'success',
        icon: 'users',
      },
      {
        labelKey: 'console.metric.structureGaps',
        value: '2',
        hintKey: 'console.metric.structureGapsHint',
        tone: 'warning',
        icon: 'building',
      },
      {
        labelKey: 'console.metric.referenceSets',
        value: String(this.toolCount()),
        hintKey: 'console.metric.referenceSetsHint',
        tone: 'info',
        icon: 'database',
      },
      {
        labelKey: 'console.metric.auditTrail',
        value: '100%',
        hintKey: 'console.metric.auditTrailHint',
        tone: 'success',
        icon: 'scrollText',
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
          icon: 'alert',
        },
        {
          titleKey: 'console.queue.reviewEvidence',
          metaKey: 'console.queue.reviewEvidenceMeta',
          actionKey: 'console.queue.reviewEvidenceAction',
          link: '/governance/ndi/gaps',
          tone: 'danger',
          icon: 'fileCheck',
        },
      ];
    }

    if (this.config().id === 'accessManagement') {
      return [
        {
          titleKey: 'console.queue.reviewAccess',
          metaKey: 'console.queue.reviewAccessMeta',
          actionKey: 'console.queue.reviewAccessAction',
          link: '/admin/users',
          tone: 'warning',
          icon: 'keyRound',
        },
        {
          titleKey: 'console.queue.inspectAudit',
          metaKey: 'console.queue.inspectAuditMeta',
          actionKey: 'console.queue.inspectAuditAction',
          link: '/admin/audit',
          tone: 'info',
          icon: 'scrollText',
        },
      ];
    }

    return [
      {
        titleKey: 'console.queue.completeDirectory',
        metaKey: 'console.queue.completeDirectoryMeta',
        actionKey: 'console.queue.completeDirectoryAction',
        link: '/admin/people',
        tone: 'info',
        icon: 'users',
      },
      {
        titleKey: 'console.queue.reviewIntegrations',
        metaKey: 'console.queue.reviewIntegrationsMeta',
        actionKey: 'console.queue.reviewIntegrationsAction',
        link: '/admin/integrations',
        tone: 'warning',
        icon: 'plug',
      },
    ];
  });

  protected t(key: string): string {
    return this.i18n.t(key);
  }
}
