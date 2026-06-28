import {
  ChangeDetectionStrategy,
  Component,
  HostListener,
  input,
  output,
} from '@angular/core';
import { AppIcon } from './app-icon';

/** Presentational modal dialog. Content is projected; close is emitted on backdrop/Esc/close. */
@Component({
  selector: 'app-modal',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [AppIcon],
  template: `
    <div class="overlay" (click)="onBackdrop($event)">
      <div class="modal" [class.modal--lg]="size() === 'lg'" role="dialog" aria-modal="true">
        <header class="modal__head">
          <h2 class="modal__title">{{ title() }}</h2>
          <button type="button" class="modal__close" (click)="close.emit()" aria-label="Close dialog">
            <app-icon name="x" />
          </button>
        </header>
        <div class="modal__body">
          <ng-content></ng-content>
        </div>
        <footer class="modal__foot">
          <ng-content select="[footer]"></ng-content>
        </footer>
      </div>
    </div>
  `,
  styles: [
    `
      .overlay {
        position: fixed;
        inset: 0;
        z-index: 500;
        display: grid;
        place-items: center;
        padding: var(--space-5);
        background: rgba(8, 12, 22, 0.55);
        animation: fade var(--motion-fast) var(--easing-standard);
      }

      .modal {
        width: 100%;
        max-width: 560px;
        max-height: 90vh;
        overflow: auto;
        color: var(--on-surface);
        background: var(--surface);
        border: 1px solid var(--border);
        border-radius: var(--radius-lg);
        box-shadow: var(--shadow-md);
        animation: pop var(--motion-base) var(--easing-standard);
      }

      .modal--lg {
        max-width: 980px;
      }

      .modal__head {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: var(--space-3);
        padding: var(--space-4) var(--space-5);
        border-bottom: 1px solid var(--border);
      }

      .modal__title {
        margin: 0;
        font-size: var(--font-size-lg);
      }

      .modal__close {
        display: grid;
        place-items: center;
        width: 34px;
        height: 34px;
        flex: 0 0 auto;
        color: var(--on-surface-muted);
        background: var(--surface-2);
        border: 1px solid var(--border);
        border-radius: var(--radius-sm);
        cursor: pointer;
        font: inherit;
      }

      .modal__close:hover {
        color: var(--primary);
        background: var(--primary-soft);
        border-color: color-mix(in srgb, var(--primary) 36%, var(--border));
      }

      .modal__body {
        padding: var(--space-5);
      }

      .modal__foot {
        display: flex;
        justify-content: flex-end;
        gap: var(--space-2);
        padding: var(--space-4) var(--space-5);
        border-top: 1px solid var(--border);
      }

      @media (max-width: 560px) {
        .overlay {
          align-items: end;
          padding: var(--space-3);
        }

        .modal {
          max-height: 92vh;
        }

        .modal__body,
        .modal__head,
        .modal__foot {
          padding-inline: var(--space-4);
        }
      }

      @keyframes fade {
        from { opacity: 0; }
        to { opacity: 1; }
      }

      @keyframes pop {
        from { opacity: 0; transform: translateY(8px) scale(0.99); }
        to { opacity: 1; transform: translateY(0) scale(1); }
      }
    `,
  ],
})
export class Modal {
  readonly title = input('');
  readonly size = input<'md' | 'lg'>('md');
  readonly close = output<void>();

  onBackdrop(event: MouseEvent): void {
    if ((event.target as HTMLElement).classList.contains('overlay')) {
      this.close.emit();
    }
  }

  @HostListener('document:keydown.escape')
  onEsc(): void {
    this.close.emit();
  }
}
