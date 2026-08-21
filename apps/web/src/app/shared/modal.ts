import {
  AfterViewInit,
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  HostListener,
  OnDestroy,
  ViewChild,
  inject,
  input,
  output,
} from '@angular/core';
import { DOCUMENT } from '@angular/common';
import { AppIcon } from './app-icon';
import { I18nService } from '../core/i18n.service';

/** Presentational modal dialog. Content is projected; close is emitted on backdrop/Esc/close. */
@Component({
  selector: 'app-modal',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [AppIcon],
  template: `
    <div class="overlay" (click)="onBackdrop($event)">
      <div
        #dialog
        class="modal"
        [class.modal--lg]="size() === 'lg'"
        role="dialog"
        aria-modal="true"
        aria-labelledby="app-modal-title"
        tabindex="-1"
        (keydown)="onDialogKeydown($event)"
      >
        <header class="modal__head">
          <h2 id="app-modal-title" class="modal__title">{{ title() }}</h2>
          <button type="button" class="modal__close" (click)="requestClose()" [attr.aria-label]="i18n.t('modal.close')">
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
        display: grid;
        grid-template-rows: auto minmax(0, 1fr) auto;
        width: 100%;
        max-width: 560px;
        max-height: 90vh;
        overflow: hidden;
        color: var(--on-surface);
        background: var(--surface);
        border: 1px solid var(--border);
        border-radius: var(--radius-lg);
        box-shadow: var(--shadow-md);
        animation: pop var(--motion-base) var(--easing-standard);
      }

      .modal:focus {
        outline: none;
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
        min-height: 0;
        overflow: auto;
        padding: var(--space-5);
        scrollbar-gutter: stable;
      }

      .modal__close:focus-visible {
        outline: 3px solid color-mix(in srgb, var(--primary) 42%, transparent);
        outline-offset: 2px;
      }

      .modal__foot {
        display: flex;
        justify-content: flex-end;
        gap: var(--space-2);
        padding: var(--space-4) var(--space-5);
        border-top: 1px solid var(--border);
        background: var(--surface);
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
export class Modal implements AfterViewInit, OnDestroy {
  @ViewChild('dialog', { static: true }) private readonly dialog?: ElementRef<HTMLElement>;

  protected readonly i18n = inject(I18nService);
  private readonly document = inject(DOCUMENT);
  private readonly host = inject(ElementRef<HTMLElement>);
  private readonly trigger = this.document.activeElement instanceof HTMLElement ? this.document.activeElement : null;
  private readonly isolatedElements: Array<{ element: HTMLElement; inert: boolean; ariaHidden: string | null }> = [];
  private readonly bodyOverflow = this.document.body.style.overflow;
  private readonly documentOverflow = this.document.documentElement.style.overflow;
  private released = false;
  readonly title = input('');
  readonly size = input<'md' | 'lg'>('md');
  readonly close = output<void>();

  ngAfterViewInit(): void {
    this.isolateBackground();
    queueMicrotask(() => this.dialog?.nativeElement.focus());
  }

  ngOnDestroy(): void {
    this.releaseBackground();
  }

  onBackdrop(event: MouseEvent): void {
    if ((event.target as HTMLElement).classList.contains('overlay')) {
      this.requestClose();
    }
  }

  onDialogKeydown(event: KeyboardEvent): void {
    if (event.key !== 'Tab') return;
    const dialog = this.dialog?.nativeElement;
    if (!dialog) return;
    const focusable = Array.from(dialog.querySelectorAll<HTMLElement>(
      'button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), a[href], summary, [tabindex]:not([tabindex="-1"])',
    )).filter((element) => element.offsetParent !== null && element.getAttribute('aria-hidden') !== 'true');
    if (!focusable.length) {
      event.preventDefault();
      dialog.focus();
      return;
    }
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (event.shiftKey && (this.document.activeElement === first || this.document.activeElement === dialog)) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && this.document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  }

  protected requestClose(): void {
    this.releaseBackground();
    this.close.emit();
  }

  @HostListener('document:keydown.escape')
  onEsc(): void {
    this.requestClose();
  }

  @HostListener('document:focusin', ['$event'])
  onDocumentFocus(event: FocusEvent): void {
    const dialog = this.dialog?.nativeElement;
    if (!this.released && dialog && event.target instanceof Node && !dialog.contains(event.target)) {
      dialog.focus();
    }
  }

  private isolateBackground(): void {
    let current: HTMLElement | null = this.host.nativeElement;
    while (current?.parentElement) {
      const parent = current.parentElement;
      for (const sibling of Array.from(parent.children)) {
        if (!(sibling instanceof HTMLElement) || sibling === current || sibling.tagName === 'SCRIPT') continue;
        this.isolatedElements.push({
          element: sibling,
          inert: sibling.inert,
          ariaHidden: sibling.getAttribute('aria-hidden'),
        });
        sibling.inert = true;
        sibling.setAttribute('aria-hidden', 'true');
      }
      current = parent;
      if (current === this.document.body) break;
    }
    this.document.body.style.overflow = 'hidden';
    this.document.documentElement.style.overflow = 'hidden';
  }

  private releaseBackground(): void {
    if (this.released) return;
    this.released = true;
    for (const state of this.isolatedElements) {
      state.element.inert = state.inert;
      if (state.ariaHidden === null) state.element.removeAttribute('aria-hidden');
      else state.element.setAttribute('aria-hidden', state.ariaHidden);
    }
    this.document.body.style.overflow = this.bodyOverflow;
    this.document.documentElement.style.overflow = this.documentOverflow;
    queueMicrotask(() => this.trigger?.focus());
  }
}
