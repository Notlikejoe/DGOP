import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { RouterLink } from '@angular/router';
import { I18nService } from '../../core/i18n.service';

interface AboutCard {
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
  labelKey: string;
  bodyKey: string;
  link: string;
}

@Component({
  selector: 'app-about-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink],
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
      titleKey: 'about.what.operationalized.title',
      bodyKey: 'about.what.operationalized.body',
      tone: 'success',
    },
    {
      titleKey: 'about.what.accountability.title',
      bodyKey: 'about.what.accountability.body',
      tone: 'info',
    },
    {
      titleKey: 'about.what.evidence.title',
      bodyKey: 'about.what.evidence.body',
      tone: 'warning',
    },
  ];

  protected readonly operatingModel: FlowStep[] = [
    {
      icon: 'AD',
      titleKey: 'about.flow.admin.title',
      bodyKey: 'about.flow.admin.body',
    },
    {
      icon: 'OW',
      titleKey: 'about.flow.ownership.title',
      bodyKey: 'about.flow.ownership.body',
    },
    {
      icon: 'A3',
      titleKey: 'about.flow.asset.title',
      bodyKey: 'about.flow.asset.body',
    },
    {
      icon: 'CM',
      titleKey: 'about.flow.case.title',
      bodyKey: 'about.flow.case.body',
    },
    {
      icon: 'EV',
      titleKey: 'about.flow.evidence.title',
      bodyKey: 'about.flow.evidence.body',
    },
  ];

  protected readonly towers: AboutCard[] = [
    {
      titleKey: 'about.tower.governance.title',
      bodyKey: 'about.tower.governance.body',
      tone: 'success',
    },
    {
      titleKey: 'about.tower.compliance.title',
      bodyKey: 'about.tower.compliance.body',
      tone: 'warning',
    },
    {
      titleKey: 'about.tower.data.title',
      bodyKey: 'about.tower.data.body',
      tone: 'info',
    },
    {
      titleKey: 'about.tower.transparency.title',
      bodyKey: 'about.tower.transparency.body',
      tone: 'info',
    },
    {
      titleKey: 'about.tower.value.title',
      bodyKey: 'about.tower.value.body',
      tone: 'success',
    },
    {
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

  protected readonly quickLinks: QuickLink[] = [
    {
      labelKey: 'about.link.governance.title',
      bodyKey: 'about.link.governance.body',
      link: '/governance',
    },
    {
      labelKey: 'about.link.admin.title',
      bodyKey: 'about.link.admin.body',
      link: '/admin',
    },
    {
      labelKey: 'about.link.design.title',
      bodyKey: 'about.link.design.body',
      link: '/governance-map',
    },
  ];

  protected t(key: string): string {
    return this.i18n.t(key);
  }
}
