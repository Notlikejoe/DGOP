import { ChangeDetectionStrategy, Component, input } from '@angular/core';

export type StatusKind = 'success' | 'warning' | 'danger' | 'info' | 'muted';

/** Shared status chip: color is always paired with text for accessibility. */
@Component({
  selector: 'app-status-chip',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <span class="ds-chip ds-chip--{{ kind() }}">
      <span class="ds-chip__dot" aria-hidden="true"></span>
      <span>{{ label() }}</span>
    </span>
  `,
})
export class StatusChip {
  readonly kind = input<StatusKind>('muted');
  readonly label = input.required<string>();
}
