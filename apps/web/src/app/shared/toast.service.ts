import { Injectable, inject, signal } from '@angular/core';
import { ErrorExperienceService } from '../core/error-experience.service';
import { I18nService } from '../core/i18n.service';

export type ToastKind = 'success' | 'error' | 'info';
export interface Toast {
  id: number;
  kind: ToastKind;
  text: string;
}

@Injectable({ providedIn: 'root' })
export class ToastService {
  readonly toasts = signal<Toast[]>([]);
  private seq = 0;
  private readonly errors = inject(ErrorExperienceService);
  private readonly i18n = inject(I18nService);

  show(text: string, kind: ToastKind = 'info'): void {
    const id = ++this.seq;
    this.toasts.update((list) => [...list, { id, kind, text }]);
    setTimeout(() => this.dismiss(id), 4000);
  }

  success(text: string): void {
    this.show(text, 'success');
  }

  error(text: string): void {
    this.show(text, 'error');
  }

  errorFrom(error: unknown, fallback?: string): void {
    const interpreted = this.errors.interpret(error);
    const request = interpreted.requestId ? ` ${this.i18n.t('error.requestId')} ${interpreted.requestId}` : '';
    const text = interpreted.message
      ? `${interpreted.title}: ${interpreted.message}${request}`
      : (fallback ?? interpreted.title);
    this.show(text, 'error');
  }

  dismiss(id: number): void {
    this.toasts.update((list) => list.filter((t) => t.id !== id));
  }

}
