import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';

export type BarKind = 'success' | 'info' | 'warning' | 'danger';

/** Shared horizontal progress bar (0-100). Exposes ARIA progressbar semantics. */
@Component({
  selector: 'app-progress-bar',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <span
      class="ds-bar"
      role="progressbar"
      [attr.aria-valuenow]="clamped()"
      aria-valuemin="0"
      aria-valuemax="100"
      [attr.aria-label]="label() || null"
    >
      <span class="ds-bar__fill ds-bar__fill--{{ kind() }}" [style.width.%]="clamped()"></span>
    </span>
  `,
  styles: [
    `
      .ds-bar {
        display: block;
        height: 0.6rem;
        border-radius: 0.3rem;
        background: var(--ds-surface-muted, #e2e8f0);
        overflow: hidden;
      }
      .ds-bar__fill {
        display: block;
        height: 100%;
        border-radius: 0.3rem;
        transition: width 0.25s ease;
      }
      .ds-bar__fill--success {
        background: var(--ds-success, #16a34a);
      }
      .ds-bar__fill--info {
        background: var(--ds-info, #2563eb);
      }
      .ds-bar__fill--warning {
        background: var(--ds-warning, #d97706);
      }
      .ds-bar__fill--danger {
        background: var(--ds-danger, #dc2626);
      }
    `,
  ],
})
export class ProgressBar {
  readonly value = input.required<number>();
  readonly kind = input<BarKind>('info');
  readonly label = input<string>('');

  protected readonly clamped = computed(() => Math.max(0, Math.min(100, Math.round(this.value()))));
}
