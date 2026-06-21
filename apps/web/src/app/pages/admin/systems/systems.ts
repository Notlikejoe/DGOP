import { ChangeDetectionStrategy, Component } from '@angular/core';
import { MasterDataPage } from '../master-data/master-data-page';
import { MasterDataConfig } from '../master-data/master-data.types';

@Component({
  selector: 'app-admin-systems',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [MasterDataPage],
  template: `<app-master-data [config]="config" />`,
})
export class SystemsPage {
  protected readonly config: MasterDataConfig = {
    titleKey: 'nav.systems',
    subtitleKey: 'systems.subtitle',
    apiBase: '/api/systems',
    columns: [
      { key: 'code', labelKey: 'crud.code' },
      { key: 'name', labelKey: 'crud.name', kind: 'i18nName' },
      { key: 'type', labelKey: 'systems.type' },
      { key: 'ownerOrgUnit', labelKey: 'systems.owner', kind: 'ref', refKey: 'ownerOrgUnit' },
      { key: 'isActive', labelKey: 'crud.status', kind: 'boolean' },
    ],
    fields: [
      { key: 'code', labelKey: 'crud.code', type: 'text', required: true },
      { key: 'nameEn', labelKey: 'crud.nameEn', type: 'text', required: true },
      { key: 'nameAr', labelKey: 'crud.nameAr', type: 'text', required: true },
      { key: 'type', labelKey: 'systems.type', type: 'text' },
      { key: 'vendor', labelKey: 'systems.vendor', type: 'text' },
      { key: 'ownerOrgUnitId', labelKey: 'systems.owner', type: 'select', optionsFrom: '/api/org-units' },
      { key: 'description', labelKey: 'crud.description', type: 'textarea' },
      { key: 'isActive', labelKey: 'crud.active', type: 'checkbox' },
    ],
  };
}
