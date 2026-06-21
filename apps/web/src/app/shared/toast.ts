import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { ToastService } from './toast.service';

@Component({
  selector: 'app-toast',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="toasts" aria-live="polite" aria-atomic="true">
      @for (t of toast.toasts(); track t.id) {
        <div class="toast toast--{{ t.kind }}" role="status">
          <span>{{ t.text }}</span>
          <button type="button" class="toast__close" (click)="toast.dismiss(t.id)" aria-label="Dismiss">
            ✕
          </button>
        </div>
      }
    </div>
  `,
  styles: [
    `
      .toasts {
        position: fixed;
        inset-block-end: var(--space-5);
        inset-inline-end: var(--space-5);
        display: flex;
        flex-direction: column;
        gap: var(--space-2);
        z-index: 1000;
      }
      .toast {
        display: flex;
        align-items: center;
        gap: var(--space-4);
        padding: var(--space-3) var(--space-4);
        border-radius: var(--radius-md);
        box-shadow: var(--shadow-md);
        border: 1px solid var(--border);
        background: var(--surface);
        min-width: 240px;
        animation: toast-in var(--motion-base) var(--easing-standard);
      }
      .toast--success {
        border-inline-start: 4px solid var(--success);
      }
      .toast--error {
        border-inline-start: 4px solid var(--danger);
      }
      .toast--info {
        border-inline-start: 4px solid var(--info);
      }
      .toast__close {
        margin-inline-start: auto;
        background: transparent;
        border: none;
        cursor: pointer;
        color: var(--on-surface-muted);
        font: inherit;
      }
      @keyframes toast-in {
        from {
          opacity: 0;
          transform: translateY(8px);
        }
        to {
          opacity: 1;
          transform: translateY(0);
        }
      }
    `,
  ],
})
export class ToastHost {
  protected readonly toast = inject(ToastService);
}
