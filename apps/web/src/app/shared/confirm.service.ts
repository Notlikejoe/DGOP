import { Injectable, signal } from '@angular/core';

interface ConfirmState {
  open: boolean;
  messageKey: string;
}

@Injectable({ providedIn: 'root' })
export class ConfirmService {
  readonly state = signal<ConfirmState>({ open: false, messageKey: '' });
  private resolver?: (value: boolean) => void;

  ask(messageKey: string): Promise<boolean> {
    this.state.set({ open: true, messageKey });
    return new Promise<boolean>((resolve) => {
      this.resolver = resolve;
    });
  }

  resolve(value: boolean): void {
    this.state.set({ open: false, messageKey: '' });
    this.resolver?.(value);
    this.resolver = undefined;
  }
}
