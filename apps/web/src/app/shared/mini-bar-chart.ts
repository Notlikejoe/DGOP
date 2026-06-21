import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { BarKind } from './progress-bar';

export interface MiniBarItem {
  label: string;
  value: number;
  kind?: BarKind;
  /** Optional router link target for the row. */
  link?: string | unknown[] | null;
  /** Optional query params when linking. */
  queryParams?: Record<string, unknown>;
}

/**
 * Tiny horizontal bar chart: each row is label + bar (scaled to the max) + value.
 * Pure presentation; bars are scaled relative to the largest value so categories
 * stay comparable. Empty input renders nothing.
 */
@Component({
  selector: 'app-mini-bar-chart',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (items().length) {
      <ul class="ds-mbc">
        @for (it of items(); track it.label) {
          <li class="ds-mbc__row">
            <span class="ds-mbc__label">{{ it.label }}</span>
            <span class="ds-mbc__track">
              <span
                class="ds-mbc__fill ds-mbc__fill--{{ it.kind || 'info' }}"
                [style.width.%]="pct(it.value)"
              ></span>
            </span>
            <span class="ds-mbc__value">{{ it.value }}</span>
          </li>
        }
      </ul>
    }
  `,
  styles: [
    `
      .ds-mbc {
        list-style: none;
        margin: 0;
        padding: 0;
        display: flex;
        flex-direction: column;
        gap: 0.5rem;
      }
      .ds-mbc__row {
        display: grid;
        grid-template-columns: 7rem 1fr 2.5rem;
        align-items: center;
        gap: 0.6rem;
      }
      .ds-mbc__label {
        font-size: 0.8rem;
        color: var(--ds-text-muted, #475569);
        font-weight: 600;
        text-transform: capitalize;
      }
      .ds-mbc__track {
        display: block;
        height: 0.55rem;
        border-radius: 0.3rem;
        background: var(--ds-surface-muted, #e2e8f0);
        overflow: hidden;
      }
      .ds-mbc__fill {
        display: block;
        height: 100%;
        border-radius: 0.3rem;
        min-width: 2px;
      }
      .ds-mbc__fill--success {
        background: var(--ds-success, #16a34a);
      }
      .ds-mbc__fill--info {
        background: var(--ds-info, #2563eb);
      }
      .ds-mbc__fill--warning {
        background: var(--ds-warning, #d97706);
      }
      .ds-mbc__fill--danger {
        background: var(--ds-danger, #dc2626);
      }
      .ds-mbc__value {
        font-variant-numeric: tabular-nums;
        font-weight: 700;
        text-align: end;
      }
    `,
  ],
})
export class MiniBarChart {
  readonly items = input.required<MiniBarItem[]>();

  private readonly max = computed(() =>
    Math.max(1, ...this.items().map((i) => (i.value > 0 ? i.value : 0))),
  );

  protected pct(value: number): number {
    return Math.round((Math.max(0, value) / this.max()) * 100);
  }
}
