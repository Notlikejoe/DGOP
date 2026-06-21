import { ChangeDetectionStrategy, Component } from '@angular/core';
import { MasterDataPage } from '../master-data/master-data-page';
import { MasterDataConfig } from '../master-data/master-data.types';

@Component({
  selector: 'app-admin-classifications',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [MasterDataPage],
  template: `<app-master-data [config]="config" />`,
})
export class ClassificationsPage {
  protected readonly config: MasterDataConfig = {
    titleKey: 'nav.classifications',
    subtitleKey: 'classifications.subtitle',
    apiBase: '/api/classifications',
    columns: [
      { key: 'rank', labelKey: 'classifications.rank' },
      { key: 'code', labelKey: 'crud.code' },
      { key: 'name', labelKey: 'crud.name', kind: 'i18nName' },
      { key: 'color', labelKey: 'classifications.color', kind: 'color' },
      { key: 'isActive', labelKey: 'crud.status', kind: 'boolean' },
    ],
    fields: [
      { key: 'code', labelKey: 'crud.code', type: 'text', required: true },
      { key: 'nameEn', labelKey: 'crud.nameEn', type: 'text', required: true },
      { key: 'nameAr', labelKey: 'crud.nameAr', type: 'text', required: true },
      { key: 'rank', labelKey: 'classifications.rank', type: 'number', required: true },
      { key: 'color', labelKey: 'classifications.color', type: 'color', required: true },
      { key: 'description', labelKey: 'crud.description', type: 'textarea' },
      { key: 'isActive', labelKey: 'crud.active', type: 'checkbox' },
    ],
  };
}
