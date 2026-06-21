import { ChangeDetectionStrategy, Component } from '@angular/core';
import { HierarchyPage, HierarchyPageConfig } from '../hierarchy/hierarchy-page';

@Component({
  selector: 'app-admin-business-capabilities',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [HierarchyPage],
  template: `<app-hierarchy-page [config]="config" />`,
})
export class BusinessCapabilitiesPage {
  protected readonly config: HierarchyPageConfig = {
    apiBase: '/api/business-capabilities',
    titleKey: 'nav.capabilities',
    subtitleKey: 'capabilities.subtitle',
    addRootKey: 'capabilities.addRoot',
    newTitleKey: 'capabilities.newTitle',
    editTitleKey: 'capabilities.editTitle',
  };
}
