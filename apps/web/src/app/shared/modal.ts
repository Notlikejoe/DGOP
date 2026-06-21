import {
  ChangeDetectionStrategy,
  Component,
  HostListener,
  input,
  output,
} from '@angular/core';

/** Presentational modal dialog. Content is projected; close is emitted on backdrop/Esc/X. */
@Component({
  selector: 'app-modal',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="overlay" (click)="onBackdrop($event)">
      <div class="modal" role="dialog" aria-modal="true">
        <header class="modal__head">
          <h2 class="modal__title">{{ title() }}</h2>
          <button type="button" class="modal__close" (click)="close.emit()" aria-label="Close">✕</button>
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
        background: rgba(8, 12, 22, 0.55);
        display: grid;
        place-items: center;
        padding: var(--space-5);
        z-index: 500;
        animation: fade var(--motion-fast) var(--easing-standard);
      }
      .modal {
        width: 100%;
        max-width: 560px;
        max-height: 90vh;
        overflow: auto;
        background: var(--surface);
        border: 1px solid var(--border);
        border-radius: var(--radius-lg);
        box-shadow: var(--shadow-md);
        animation: pop var(--motion-base) var(--easing-standard);
      }
      .modal__head {
        display: flex;
        align-items: center;
        justify-content: space-between;
        padding: var(--space-4) var(--space-5);
        border-bottom: 1px solid var(--border);
      }
      .modal__title {
        margin: 0;
        font-size: var(--font-size-lg);
      }
      .modal__close {
        background: transparent;
        border: none;
        cursor: pointer;
        font: inherit;
        color: var(--on-surface-muted);
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
