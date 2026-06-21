import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import { NgTemplateOutlet } from '@angular/common';
import { RouterLink } from '@angular/router';

export type KpiTone = 'neutral' | 'success' | 'warning' | 'danger' | 'info';

/**
 * Shared KPI tile: a big value with a label and optional hint. Renders as a link
 * when `link` is provided (keyboard-focusable), otherwise as a static card.
 */
@Component({
  selector: 'app-kpi-card',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink, NgTemplateOutlet],
  template: `
    @if (link()) {
      <a class="ds-kpi ds-kpi--{{ tone() }} ds-kpi--link" [routerLink]="link()">
        <ng-container [ngTemplateOutlet]="body"></ng-container>
      </a>
    } @else {
      <div class="ds-kpi ds-kpi--{{ tone() }}">
        <ng-container [ngTemplateOutlet]="body"></ng-container>
      </div>
    }

    <ng-template #body>
      <span class="ds-kpi__value">{{ value() }}</span>
      <span class="ds-kpi__label">{{ label() }}</span>
      @if (hint()) {
        <span class="ds-kpi__hint">{{ hint() }}</span>
      }
    </ng-template>
  `,
  styles: [
    `
      .ds-kpi {
        display: flex;
        flex-direction: column;
        gap: 0.35rem;
        align-items: flex-start;
        padding: 1rem 1.1rem;
        border: 1px solid var(--ds-border, #e2e8f0);
        border-inline-start: 4px solid var(--ds-border, #cbd5e1);
        border-radius: 0.6rem;
        background: var(--ds-surface, #fff);
        min-height: 92px;
      }
      .ds-kpi--link {
        text-decoration: none;
        color: inherit;
        transition: transform 0.1s, box-shadow 0.1s;
      }
      .ds-kpi--link:hover {
        transform: translateY(-2px);
        box-shadow: 0 4px 14px rgba(0, 0, 0, 0.08);
      }
      .ds-kpi__value {
        font-size: 1.7rem;
        font-weight: 700;
        line-height: 1.1;
        font-variant-numeric: tabular-nums;
      }
      .ds-kpi__label {
        font-size: 0.82rem;
        font-weight: 600;
        color: var(--ds-text-muted, #64748b);
      }
      .ds-kpi__hint {
        font-size: 0.75rem;
        color: var(--ds-text-muted, #94a3b8);
      }
      .ds-kpi--success {
        border-inline-start-color: var(--ds-success, #16a34a);
      }
      .ds-kpi--warning {
        border-inline-start-color: var(--ds-warning, #d97706);
      }
      .ds-kpi--danger {
        border-inline-start-color: var(--ds-danger, #dc2626);
      }
      .ds-kpi--info {
        border-inline-start-color: var(--ds-info, #2563eb);
      }
    `,
  ],
})
export class KpiCard {
  readonly value = input.required<string | number>();
  readonly label = input.required<string>();
  readonly hint = input<string>('');
  readonly tone = input<KpiTone>('neutral');
  readonly link = input<string | unknown[] | null>(null);
}
