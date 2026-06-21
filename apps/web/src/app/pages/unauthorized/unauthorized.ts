import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { RouterLink } from '@angular/router';
import { I18nService } from '../../core/i18n.service';

@Component({
  selector: 'app-unauthorized',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink],
  template: `
    <div class="center">
      <div class="ds-card box">
        <div class="box__code" aria-hidden="true">403</div>
        <h1>{{ t('unauth.title') }}</h1>
        <p class="box__msg">{{ t('unauth.message') }}</p>
        <a class="ds-btn ds-btn--primary" routerLink="/dashboard">{{ t('unauth.back') }}</a>
      </div>
    </div>
  `,
  styles: [
    `
      .center {
        min-height: 100vh;
        display: grid;
        place-items: center;
        padding: var(--space-5);
        background: var(--bg);
      }
      .box {
        max-width: 420px;
        text-align: center;
      }
      .box__code {
        font-size: 3rem;
        font-weight: 700;
        color: var(--danger);
      }
      .box__msg {
        color: var(--on-surface-muted);
        margin-bottom: var(--space-5);
      }
    `,
  ],
})
export class Unauthorized {
  private readonly i18n = inject(I18nService);
  protected t(key: string): string {
    return this.i18n.t(key);
  }
}
