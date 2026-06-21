import { ChangeDetectionStrategy, Component } from '@angular/core';
import { HierarchyPage, HierarchyPageConfig } from '../hierarchy/hierarchy-page';

@Component({
  selector: 'app-admin-org-units',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [HierarchyPage],
  template: `<app-hierarchy-page [config]="config" />`,
})
export class OrgUnitsPage {
  protected readonly config: HierarchyPageConfig = {
    apiBase: '/api/org-units',
    titleKey: 'nav.orgUnits',
    subtitleKey: 'orgUnits.subtitle',
    addRootKey: 'orgUnits.addRoot',
    newTitleKey: 'orgUnits.newTitle',
    editTitleKey: 'orgUnits.editTitle',
    showDescription: false,
  };
}
