import { ChangeDetectionStrategy, Component } from '@angular/core';
import { MasterDataPage } from '../master-data/master-data-page';
import { MasterDataConfig } from '../master-data/master-data.types';

@Component({
  selector: 'app-admin-role-types',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [MasterDataPage],
  template: `<app-master-data [config]="config" />`,
})
export class RoleTypesPage {
  protected readonly config: MasterDataConfig = {
    titleKey: 'nav.roleTypes',
    subtitleKey: 'roleTypes.subtitle',
    apiBase: '/api/role-types',
    columns: [
      { key: 'code', labelKey: 'crud.code' },
      { key: 'name', labelKey: 'crud.name', kind: 'i18nName' },
      { key: 'isActive', labelKey: 'crud.status', kind: 'boolean' },
    ],
    fields: [
      { key: 'code', labelKey: 'crud.code', type: 'text', required: true },
      { key: 'nameEn', labelKey: 'crud.nameEn', type: 'text', required: true },
      { key: 'nameAr', labelKey: 'crud.nameAr', type: 'text', required: true },
      { key: 'description', labelKey: 'crud.description', type: 'textarea' },
      { key: 'isActive', labelKey: 'crud.active', type: 'checkbox' },
    ],
  };
}
