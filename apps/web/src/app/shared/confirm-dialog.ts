import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { ConfirmService } from './confirm.service';
import { I18nService } from '../core/i18n.service';
import { Modal } from './modal';

@Component({
  selector: 'app-confirm-dialog',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [Modal],
  template: `
    @if (confirm.state().open) {
      <app-modal [title]="t('confirm.title')" (close)="confirm.resolve(false)">
        <p>{{ t(confirm.state().messageKey) }}</p>
        <div footer>
          <button type="button" class="ds-btn ds-btn--ghost" (click)="confirm.resolve(false)">
            {{ t('confirm.cancel') }}
          </button>
          <button type="button" class="ds-btn ds-btn--primary" (click)="confirm.resolve(true)">
            {{ t('confirm.confirm') }}
          </button>
        </div>
      </app-modal>
    }
  `,
})
export class ConfirmDialog {
  protected readonly confirm = inject(ConfirmService);
  private readonly i18n = inject(I18nService);
  protected t(key: string): string {
    return this.i18n.t(key);
  }
}
