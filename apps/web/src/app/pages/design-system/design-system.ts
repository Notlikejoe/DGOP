import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { I18nService } from '../../core/i18n.service';
import { StatusChip } from '../../shared/status-chip';
import { TreeView, TreeRow } from '../../shared/tree-view';

@Component({
  selector: 'app-design-system',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [StatusChip, TreeView],
  templateUrl: './design-system.html',
  styleUrl: './design-system.scss',
})
export class DesignSystem {
  protected readonly i18n = inject(I18nService);

  protected readonly demoTree: TreeRow[] = [
    { id: '1', label: 'Ministry of Health', sublabel: 'MOH', depth: 0 },
    { id: '2', label: 'IT Department', sublabel: 'MOH-IT', depth: 1 },
    { id: '3', label: 'Data Governance Office', sublabel: 'MOH-DGO', depth: 1 },
    { id: '4', label: 'Stewardship Team', sublabel: 'MOH-DGO-ST', depth: 2 },
  ];

  protected t(key: string): string {
    return this.i18n.t(key);
  }
}
