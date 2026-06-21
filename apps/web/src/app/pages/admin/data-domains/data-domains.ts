import { ChangeDetectionStrategy, Component } from '@angular/core';
import { HierarchyPage, HierarchyPageConfig } from '../hierarchy/hierarchy-page';

@Component({
  selector: 'app-admin-data-domains',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [HierarchyPage],
  template: `<app-hierarchy-page [config]="config" />`,
})
export class DataDomainsPage {
  protected readonly config: HierarchyPageConfig = {
    apiBase: '/api/data-domains',
    titleKey: 'nav.dataDomains',
    subtitleKey: 'dataDomains.subtitle',
    addRootKey: 'dataDomains.addRoot',
    newTitleKey: 'dataDomains.newTitle',
    editTitleKey: 'dataDomains.editTitle',
  };
}
