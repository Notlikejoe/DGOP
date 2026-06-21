import { ChangeDetectionStrategy, Component, input, output } from '@angular/core';

export interface TreeRow {
  id: string;
  label: string;
  sublabel?: string;
  depth: number;
}

/** Presentational tree (flattened with depth). Optional row actions are emitted by id. */
@Component({
  selector: 'app-tree-view',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <ul class="tree" role="tree">
      @for (row of rows(); track row.id) {
        <li class="tree__node" role="treeitem">
          <div class="tree__row" [style.padding-inline-start.px]="row.depth * 20">
            <span class="tree__twig" aria-hidden="true">{{ row.depth > 0 ? '└' : '▸' }}</span>
            <span class="tree__label">{{ row.label }}</span>
            @if (row.sublabel) {
              <span class="tree__sub">{{ row.sublabel }}</span>
            }
            @if (showActions()) {
              <span class="tree__actions">
                <button type="button" class="tree__btn" (click)="add.emit(row.id)" title="Add child">＋</button>
                <button type="button" class="tree__btn" (click)="edit.emit(row.id)" title="Edit">✎</button>
                <button type="button" class="tree__btn" (click)="remove.emit(row.id)" title="Delete">🗑</button>
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
        list-style: none;
        margin: 0;
        padding: 0;
      }
      .tree__row {
        display: flex;
        align-items: center;
        gap: var(--space-2);
        padding: var(--space-2) var(--space-2);
        border-radius: var(--radius-sm);
      }
      .tree__row:hover {
        background: var(--surface-2);
      }
      .tree__twig {
        color: var(--on-surface-muted);
        width: 14px;
      }
      .tree__label {
        font-weight: 600;
      }
      .tree__sub {
        color: var(--on-surface-muted);
        font-size: var(--font-size-sm);
      }
      .tree__actions {
        margin-inline-start: auto;
        display: flex;
        gap: var(--space-1);
        opacity: 0;
        transition: opacity var(--motion-fast) var(--easing-standard);
      }
      .tree__row:hover .tree__actions,
      .tree__row:focus-within .tree__actions {
        opacity: 1;
      }
      .tree__btn {
        background: transparent;
        border: 1px solid var(--border);
        border-radius: var(--radius-sm);
        cursor: pointer;
        padding: 2px 6px;
        font: inherit;
        color: var(--on-surface);
      }
      .tree__btn:hover {
        background: var(--surface);
      }
    `,
  ],
})
export class TreeView {
  readonly rows = input<TreeRow[]>([]);
  readonly showActions = input(false);
  readonly add = output<string>();
  readonly edit = output<string>();
  readonly remove = output<string>();
}
