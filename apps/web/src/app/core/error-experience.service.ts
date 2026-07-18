import { HttpErrorResponse } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { I18nService } from './i18n.service';

export interface DgopProblemDetails {
  statusCode?: number;
  code?: string;
  error?: string;
  message?: string | string[];
  userMessage?: string;
  retryable?: boolean;
  path?: string;
  timestamp?: string;
  requestId?: string;
  correlationId?: string;
}

export interface UserFacingError {
  title: string;
  message: string;
  detail: string;
  code: string;
  requestId: string;
  retryable: boolean;
  status: number;
}

@Injectable({ providedIn: 'root' })
export class ErrorExperienceService {
  private readonly i18n = inject(I18nService);

  interpret(error: unknown): UserFacingError {
    if (error instanceof HttpErrorResponse) {
      const problem = this.problem(error);
      const status = error.status || problem.statusCode || 0;
      const code = problem.code || this.codeForStatus(status);
      return {
        title: this.titleForStatus(status),
        message: problem.userMessage || this.messageForStatus(status),
        detail: this.detailFor(problem),
        code,
        requestId: problem.requestId || error.headers?.get('x-request-id') || '',
        retryable: problem.retryable ?? (status === 0 || status >= 500 || status === 429),
        status,
      };
    }

    return {
      title: this.t('error.generic.title'),
      message: this.t('error.generic.message'),
      detail: '',
      code: 'SYS-500',
      requestId: '',
      retryable: true,
      status: 0,
    };
  }

  private problem(error: HttpErrorResponse): DgopProblemDetails {
    if (error.error && typeof error.error === 'object') return error.error as DgopProblemDetails;
    return {};
  }

  private detailFor(problem: DgopProblemDetails): string {
    const raw = problem.message;
    if (Array.isArray(raw)) return raw.join(' ');
    return typeof raw === 'string' ? raw : '';
  }

  private codeForStatus(status: number): string {
    if (status === 400) return 'VAL-400';
    if (status === 401) return 'SES-401';
    if (status === 403) return 'PER-403';
    if (status === 404) return 'BUS-404';
    if (status === 409) return 'BUS-409';
    if (status === 422) return 'VAL-422';
    if (status === 429) return 'RATE-429';
    return 'SYS-500';
  }

  private titleForStatus(status: number): string {
    if (status === 0) return this.t('error.network.title');
    if (status === 401) return this.t('error.session.title');
    if (status === 403) return this.t('error.permission.title');
    if (status === 404) return this.t('error.notFound.title');
    if (status === 409) return this.t('error.conflict.title');
    if (status === 429) return this.t('error.rateLimit.title');
    if (status >= 500) return this.t('error.system.title');
    return this.t('error.validation.title');
  }

  private messageForStatus(status: number): string {
    if (status === 0) return this.t('error.network.message');
    if (status === 401) return this.t('error.session.message');
    if (status === 403) return this.t('error.permission.message');
    if (status === 404) return this.t('error.notFound.message');
    if (status === 409) return this.t('error.conflict.message');
    if (status === 429) return this.t('error.rateLimit.message');
    if (status >= 500) return this.t('error.system.message');
    return this.t('error.validation.message');
  }

  private t(key: string): string {
    return this.i18n.t(key);
  }
}
