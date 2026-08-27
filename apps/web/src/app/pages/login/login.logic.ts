import { HttpErrorResponse } from '@angular/common/http';
import { TimeoutError } from 'rxjs';
import { SessionUnavailableError } from '../../core/auth.service';

export function loginErrorKey(error: unknown): string {
  if (error instanceof SessionUnavailableError) return 'login.sessionUnavailable';
  if (error instanceof TimeoutError) return 'login.timedOut';
  if (error instanceof HttpErrorResponse) {
    if (error.status === 401) return 'login.invalid';
    if (error.status === 400) return 'login.invalidInput';
    if (error.status === 429) return 'login.rateLimited';
    if (error.status === 0 || error.status >= 500) return 'login.serviceUnavailable';
  }
  return 'login.failed';
}

export function loginReturnUrl(value: string | null): string {
  if (!value || !value.startsWith('/') || value.startsWith('//') || value.includes('\\')
    || /^\/login(?:[/?#;]|$)/i.test(value)) return '/dashboard';
  return value;
}
