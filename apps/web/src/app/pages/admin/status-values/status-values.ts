import { ChangeDetectionStrategy, Component } from '@angular/core';
import { MasterDataPage } from '../master-data/master-data-page';
import { MasterDataConfig } from '../master-data/master-data.types';

@Component({
  selector: 'app-admin-status-values',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [MasterDataPage],
  template: `<app-master-data [config]="config" />`,
})
export class StatusValuesPage {
  protected readonly config: MasterDataConfig = {
    titleKey: 'nav.statusValues',
    subtitleKey: 'statusValues.subtitle',
    apiBase: '/api/status-values',
    columns: [
      { key: 'domain', labelKey: 'statusValues.domain' },
      { key: 'sortOrder', labelKey: 'statusValues.order' },
      { key: 'code', labelKey: 'crud.code' },
      { key: 'name', labelKey: 'crud.name', kind: 'i18nName' },
      { key: 'color', labelKey: 'classifications.color', kind: 'color' },
      { key: 'isActive', labelKey: 'crud.status', kind: 'boolean' },
    ],
    fields: [
      { key: 'domain', labelKey: 'statusValues.domain', type: 'text', required: true },
      { key: 'code', labelKey: 'crud.code', type: 'text', required: true },
      { key: 'nameEn', labelKey: 'crud.nameEn', type: 'text', required: true },
      { key: 'nameAr', labelKey: 'crud.nameAr', type: 'text', required: true },
      { key: 'color', labelKey: 'classifications.color', type: 'color', required: true },
      { key: 'sortOrder', labelKey: 'statusValues.order', type: 'number' },
      { key: 'isActive', labelKey: 'crud.active', type: 'checkbox' },
    ],
  };
}
