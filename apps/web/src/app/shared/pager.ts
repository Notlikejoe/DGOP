import { ChangeDetectionStrategy, Component, computed, inject, input, output } from '@angular/core';
import { I18nService } from '../core/i18n.service';

/**
 * Reusable pagination control. Pages are 1-based. Emits `pageChange` with the
 * requested page; the parent owns the data fetching / slicing.
 */
@Component({
  selector: 'app-pager',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (total() > 0) {
      <nav class="pager" [attr.aria-label]="t('pager.page')">
        <span class="pager__summary">
          {{ t('pager.showing') }} {{ rangeStart() }}–{{ rangeEnd() }}
          {{ t('pager.of') }} {{ total() }} {{ t('pager.results') }}
        </span>
        <div class="pager__controls">
          <button
            type="button"
            class="ds-btn ds-btn--ghost ds-btn--sm"
            [disabled]="page() <= 1"
            (click)="go(page() - 1)"
          >
            {{ t('pager.prev') }}
          </button>
          <span class="pager__page">{{ t('pager.page') }} {{ page() }} {{ t('pager.of') }} {{ totalPages() }}</span>
          <button
            type="button"
            class="ds-btn ds-btn--ghost ds-btn--sm"
            [disabled]="page() >= totalPages()"
            (click)="go(page() + 1)"
          >
            {{ t('pager.next') }}
          </button>
        </div>
      </nav>
    }
  `,
  styles: [
    `
      .pager {
        display: flex;
        flex-wrap: wrap;
        align-items: center;
        justify-content: space-between;
        gap: 0.75rem;
        margin-top: 1rem;
        padding-top: 0.75rem;
        border-top: 1px solid var(--ds-border, #e5e7eb);
      }
      .pager__summary {
        font-size: 0.85rem;
        color: var(--ds-text-muted, #6b7280);
      }
      .pager__controls {
        display: flex;
        align-items: center;
        gap: 0.5rem;
      }
      .pager__page {
        font-size: 0.85rem;
        color: var(--ds-text-muted, #6b7280);
        min-width: 6rem;
        text-align: center;
      }
    `,
  ],
})
export class Pager {
  private readonly i18n = inject(I18nService);

  readonly page = input.required<number>();
  readonly pageSize = input.required<number>();
  readonly total = input.required<number>();
  readonly totalPages = input.required<number>();

  readonly pageChange = output<number>();

  protected readonly rangeStart = computed(() =>
    this.total() === 0 ? 0 : (this.page() - 1) * this.pageSize() + 1,
  );
  protected readonly rangeEnd = computed(() => Math.min(this.page() * this.pageSize(), this.total()));

  protected go(p: number): void {
    if (p < 1 || p > this.totalPages() || p === this.page()) return;
    this.pageChange.emit(p);
  }

  protected t(key: string): string {
    return this.i18n.t(key);
  }
}
