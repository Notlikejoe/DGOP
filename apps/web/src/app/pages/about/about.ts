import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { RouterLink } from '@angular/router';
import { CardModule } from 'primeng/card';
import { TagModule } from 'primeng/tag';
import { I18nService } from '../../core/i18n.service';
import { AuthService } from '../../core/auth.service';

interface AboutCard {
  icon: string;
  titleKey: string;
  bodyKey: string;
  tone: 'success' | 'warning' | 'info';
}

interface FlowStep {
  icon: string;
  titleKey: string;
  bodyKey: string;
}

interface QuickLink {
  icon: string;
  labelKey: string;
  bodyKey: string;
  link: string;
}

@Component({
  selector: 'app-about-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink, CardModule, TagModule],
  templateUrl: './about.html',
  styleUrl: './about.scss',
})
export class AboutPage {
  protected readonly i18n = inject(I18nService);

  protected readonly alignmentKeys = [
    'about.alignment.sdaia',
    'about.alignment.nora',
    'about.alignment.ecc',
    'about.alignment.pdpl',
  ];

  protected readonly principles: AboutCard[] = [
    {
      icon: 'pi pi-sitemap',
      titleKey: 'about.what.operationalized.title',
      bodyKey: 'about.what.operationalized.body',
      tone: 'success',
    },
    {
      icon: 'pi pi-users',
      titleKey: 'about.what.accountability.title',
      bodyKey: 'about.what.accountability.body',
      tone: 'info',
    },
    {
      icon: 'pi pi-verified',
      titleKey: 'about.what.evidence.title',
      bodyKey: 'about.what.evidence.body',
      tone: 'warning',
    },
  ];

  protected readonly operatingModel: FlowStep[] = [
    {
      icon: 'pi pi-cog',
      titleKey: 'about.flow.admin.title',
      bodyKey: 'about.flow.admin.body',
    },
    {
      icon: 'pi pi-user-edit',
      titleKey: 'about.flow.ownership.title',
      bodyKey: 'about.flow.ownership.body',
    },
    {
      icon: 'pi pi-database',
      titleKey: 'about.flow.asset.title',
      bodyKey: 'about.flow.asset.body',
    },
    {
      icon: 'pi pi-briefcase',
      titleKey: 'about.flow.case.title',
      bodyKey: 'about.flow.case.body',
    },
    {
      icon: 'pi pi-shield',
      titleKey: 'about.flow.evidence.title',
      bodyKey: 'about.flow.evidence.body',
    },
  ];

  protected readonly towers: AboutCard[] = [
    {
      icon: 'pi pi-sitemap',
      titleKey: 'about.tower.governance.title',
      bodyKey: 'about.tower.governance.body',
      tone: 'success',
    },
    {
      icon: 'pi pi-check-circle',
      titleKey: 'about.tower.compliance.title',
      bodyKey: 'about.tower.compliance.body',
      tone: 'warning',
    },
    {
      icon: 'pi pi-database',
      titleKey: 'about.tower.data.title',
      bodyKey: 'about.tower.data.body',
      tone: 'info',
    },
    {
      icon: 'pi pi-eye',
      titleKey: 'about.tower.transparency.title',
      bodyKey: 'about.tower.transparency.body',
      tone: 'info',
    },
    {
      icon: 'pi pi-chart-line',
      titleKey: 'about.tower.value.title',
      bodyKey: 'about.tower.value.body',
      tone: 'success',
    },
    {
      icon: 'pi pi-megaphone',
      titleKey: 'about.tower.awareness.title',
      bodyKey: 'about.tower.awareness.body',
      tone: 'warning',
    },
  ];

  protected readonly integrationKeys = [
    'about.integration.catalog',
    'about.integration.lineage',
    'about.integration.dq',
    'about.integration.dlp',
    'about.integration.pdp',
    'about.integration.ndi',
    'about.integration.risk',
    'about.integration.training',
  ];

  private readonly auth = inject(AuthService);
  private readonly quickLinkCandidates: QuickLink[] = [
    {
      icon: 'pi pi-compass',
      labelKey: 'about.link.governance.title',
      bodyKey: 'about.link.governance.body',
      link: '/governance',
    },
    {
      icon: 'pi pi-cog',
      labelKey: 'about.link.admin.title',
      bodyKey: 'about.link.admin.body',
      link: '/admin',
    },
    {
      icon: 'pi pi-map',
      labelKey: 'about.link.design.title',
      bodyKey: 'about.link.design.body',
      link: '/governance-map',
    },
  ];

  protected readonly quickLinks = computed(() => this.quickLinkCandidates.filter(item => this.auth.canAccessPage(item.link)));

  protected t(key: string): string {
    return this.i18n.t(key);
  }
}
