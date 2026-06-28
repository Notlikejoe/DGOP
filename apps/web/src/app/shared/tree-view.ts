import { ChangeDetectionStrategy, Component, inject, input, output } from '@angular/core';
import { I18nService } from '../core/i18n.service';
import { AppIcon } from './app-icon';

export interface TreeRow {
  id: string;
  label: string;
  sublabel?: string;
  code?: string;
  childCount?: number;
  depth: number;
  isActive?: boolean;
}

/** Presentational tree map for flattened hierarchy rows. */
@Component({
  selector: 'app-tree-view',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [AppIcon],
  template: `
    <ul class="tree" role="tree">
      @for (row of rows(); track row.id) {
        <li class="tree__node" role="none">
          <div class="tree__line" [style.padding-inline-start.px]="row.depth * 30">
            <button
              type="button"
              class="tree__row"
              role="treeitem"
              [class.tree__row--selected]="selectedId() === row.id"
              [attr.aria-level]="row.depth + 1"
              [attr.aria-selected]="selectedId() === row.id"
              [attr.aria-label]="rowAriaLabel(row)"
              (click)="select.emit(row.id)"
            >
              <span class="tree__marker" aria-hidden="true">
                <app-icon [name]="row.depth === 0 ? 'network' : 'tags'" />
              </span>
              <span class="tree__content">
                <span class="tree__main">
                  <span class="tree__label">{{ row.label }}</span>
                  @if (row.code) {
                    <span class="tree__code" aria-hidden="true">{{ row.code }}</span>
                  }
                </span>
                @if (row.sublabel) {
                  <span class="tree__sub">{{ row.sublabel }}</span>
                }
              </span>
              <span class="tree__meta">
                @if ((row.childCount ?? 0) > 0) {
                  <span class="tree__chip">{{ row.childCount }} {{ t('hierarchy.children') }}</span>
                }
                <span
                  class="tree__status"
                  [class.tree__status--inactive]="row.isActive === false"
                  aria-hidden="true"
                >
                  {{ row.isActive === false ? t('crud.inactive') : t('crud.active') }}
                </span>
              </span>
            </button>
            @if (showActions() && selectedId() === row.id) {
              <span class="tree__actions">
                <button type="button" class="tree__btn" (click)="add.emit(row.id)" [attr.aria-label]="t('hierarchy.addChild')">
                  <app-icon name="plus" />
                </button>
                <button type="button" class="tree__btn" (click)="edit.emit(row.id)" [attr.aria-label]="t('crud.edit')">
                  <app-icon name="edit" />
                </button>
              </span>
            }
          </div>
        </li>
      }
    </ul>
  `,
  styles: [
    `
      .tree {
        display: flex;
        flex-direction: column;
        gap: var(--space-2);
        list-style: none;
        margin: 0;
        padding: 0;
      }

      .tree__node {
        min-width: 0;
      }

      .tree__line {
        position: relative;
        display: flex;
        align-items: center;
        gap: var(--space-2);
        min-width: 0;
      }

      .tree__line::before {
        content: '';
        position: absolute;
        inset-inline-start: max(0px, calc(var(--space-3) - 1px));
        top: -10px;
        bottom: calc(50% + 1px);
        width: 1px;
        background: color-mix(in srgb, var(--command-border) 70%, transparent);
      }

      .tree__row {
        flex: 1 1 auto;
        min-width: 0;
        display: grid;
        grid-template-columns: 34px minmax(0, 1fr) auto;
        align-items: center;
        gap: var(--space-3);
        padding: var(--space-2);
        color: var(--command-on);
        background: var(--command-surface-2);
        border: 1px solid var(--command-border);
        border-radius: var(--radius-md);
        cursor: pointer;
        font: inherit;
        text-align: start;
        transition:
          background var(--motion-fast) var(--easing-standard),
          border-color var(--motion-fast) var(--easing-standard),
          transform var(--motion-fast) var(--easing-standard);
      }

      .tree__row:hover {
        border-color: color-mix(in srgb, var(--command-accent) 34%, var(--command-border));
        background: color-mix(in srgb, var(--command-active) 64%, var(--command-surface-2));
      }

      .tree__row--selected {
        border-color: color-mix(in srgb, var(--command-accent) 60%, var(--command-border));
        background: var(--command-active);
        box-shadow: inset 3px 0 0 var(--command-accent);
      }

      :host-context([dir='rtl']) .tree__row--selected {
        box-shadow: inset -3px 0 0 var(--command-accent);
      }

      .tree__marker {
        display: grid;
        place-items: center;
        width: 34px;
        height: 34px;
        color: var(--command-mark-on);
        background: var(--command-mark-bg);
        border: 1px solid color-mix(in srgb, var(--command-accent) 32%, var(--command-border));
        border-radius: var(--radius-sm);
        font-size: 1rem;
      }

      .tree__content {
        min-width: 0;
        display: flex;
        flex-direction: column;
        gap: 2px;
      }

      .tree__main {
        display: flex;
        align-items: center;
        gap: var(--space-2);
        min-width: 0;
      }

      .tree__label {
        min-width: 0;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
        font-weight: 800;
      }

      .tree__code,
      .tree__chip,
      .tree__status {
        display: inline-flex;
        align-items: center;
        width: max-content;
        max-width: 100%;
        padding: 2px var(--space-2);
        border: 1px solid var(--command-border);
        border-radius: var(--radius-pill);
        color: var(--command-muted);
        background: color-mix(in srgb, var(--command-surface) 68%, transparent);
        font-size: var(--font-size-xs);
        font-weight: 750;
        line-height: 1.2;
      }

      .tree__sub {
        color: var(--command-muted);
        font-size: var(--font-size-sm);
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }

      .tree__meta {
        display: flex;
        align-items: center;
        justify-content: flex-end;
        gap: var(--space-2);
        min-width: max-content;
      }

      .tree__status {
        color: var(--success);
        background: var(--success-soft);
        border-color: color-mix(in srgb, var(--success) 35%, transparent);
      }

      .tree__status--inactive {
        color: var(--warning);
        background: var(--warning-soft);
        border-color: color-mix(in srgb, var(--warning) 40%, transparent);
      }

      .tree__actions {
        display: flex;
        gap: var(--space-1);
        flex: 0 0 auto;
      }

      .tree__btn {
        display: grid;
        place-items: center;
        width: 34px;
        height: 34px;
        color: var(--command-on);
        background: var(--command-surface-2);
        border: 1px solid var(--command-border);
        border-radius: var(--radius-sm);
        cursor: pointer;
        padding: 0;
        font: inherit;
        font-size: 0.95rem;
      }

      .tree__btn:hover {
        color: var(--command-mark-on);
        background: var(--command-active);
        border-color: color-mix(in srgb, var(--command-accent) 44%, var(--command-border));
      }

      .tree__btn--danger:hover {
        color: var(--danger);
        background: var(--danger-soft);
        border-color: color-mix(in srgb, var(--danger) 40%, var(--command-border));
      }

      @media (max-width: 760px) {
        .tree__line {
          padding-inline-start: 0 !important;
          align-items: flex-start;
        }

        .tree__line::before {
          display: none;
        }

        .tree__row {
          grid-template-columns: 30px minmax(0, 1fr);
        }

        .tree__marker {
          width: 30px;
          height: 30px;
        }

        .tree__meta {
          grid-column: 2;
          justify-content: flex-start;
          flex-wrap: wrap;
          min-width: 0;
        }

        .tree__actions {
          flex-direction: column;
        }
      }
    `,
  ],
})
export class TreeView {
  private readonly i18n = inject(I18nService);

  readonly rows = input<TreeRow[]>([]);
  readonly showActions = input(false);
  readonly selectedId = input<string | null>(null);
  readonly select = output<string>();
  readonly add = output<string>();
  readonly edit = output<string>();
  readonly remove = output<string>();

  protected t(key: string): string {
    return this.i18n.t(key);
  }

  protected rowAriaLabel(row: TreeRow): string {
    const parts = [row.label];
    if (row.code) parts.push(`${this.t('crud.code')}: ${row.code}`);
    if ((row.childCount ?? 0) > 0) parts.push(`${row.childCount} ${this.t('hierarchy.children')}`);
    parts.push(row.isActive === false ? this.t('crud.inactive') : this.t('crud.active'));
    return parts.join(', ');
  }
}
