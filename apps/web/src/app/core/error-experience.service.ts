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
  method?: string;
  path?: string;
  timestamp?: string;
  requestId?: string;
  correlationId?: string;
}

export type UserFacingErrorCategory =
  | 'validation'
  | 'conflict'
  | 'import'
  | 'permission'
  | 'session'
  | 'network'
  | 'system'
  | 'not-found';

export interface UserFacingError {
  title: string;
  message: string;
  detail: string;
  violations: string[];
  nextSteps: string[];
  code: string;
  requestId: string;
  path: string;
  method: string;
  retryable: boolean;
  status: number;
  category: UserFacingErrorCategory;
}

@Injectable({ providedIn: 'root' })
export class ErrorExperienceService {
  private readonly i18n = inject(I18nService);

  interpret(error: unknown): UserFacingError {
    if (error instanceof HttpErrorResponse) {
      const problem = this.problem(error);
      const status = error.status || problem.statusCode || 0;
      const code = problem.code || this.codeForStatus(status);
      const category = this.categoryFor(status, code);
      const violations = this.violationsFor(problem);
      return {
        title: this.titleFor(status, category),
        message: problem.userMessage || this.messageForStatus(status),
        detail: this.detailFor(problem),
        violations,
        nextSteps: this.nextStepsFor(category, code, violations.length),
        code,
        requestId: problem.requestId || error.headers?.get('x-request-id') || '',
        path: problem.path || error.url || '',
        method: problem.method || '',
        retryable: problem.retryable ?? (status === 0 || status >= 500 || status === 429),
        status,
        category,
      };
    }

    return {
      title: this.t('error.generic.title'),
      message: this.t('error.generic.message'),
      detail: '',
      violations: [],
      nextSteps: [this.t('problem.step.retry'), this.t('problem.step.support')],
      code: 'SYS-500',
      requestId: '',
      path: '',
      method: '',
      retryable: true,
      status: 0,
      category: 'system',
    };
  }

  shouldExplain(error: UserFacingError): boolean {
    return ['validation', 'conflict', 'import'].includes(error.category);
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

  private violationsFor(problem: DgopProblemDetails): string[] {
    const raw = problem.message;
    const values = Array.isArray(raw) ? raw : typeof raw === 'string' ? raw.split(';') : [];
    return values
      .map((value) => value.trim())
      .filter(Boolean)
      .filter((value, index, all) => all.indexOf(value) === index);
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

  private titleFor(status: number, category: UserFacingErrorCategory): string {
    if (category === 'validation') return this.t('problem.validation.title');
    if (category === 'conflict') return this.t('problem.conflict.title');
    if (category === 'import') return this.t('problem.import.title');
    return this.titleForStatus(status);
  }

  private categoryFor(status: number, code: string): UserFacingErrorCategory {
    if (status === 0) return 'network';
    if (status === 401) return 'session';
    if (status === 403) return 'permission';
    if (status === 404) return 'not-found';
    if (code === 'INT-400') return 'import';
    if (status === 409 || code === 'BUS-409') return 'conflict';
    if (status === 400 || status === 422 || code.startsWith('VAL-')) return 'validation';
    if (status >= 500) return 'system';
    return 'validation';
  }

  private nextStepsFor(
    category: UserFacingErrorCategory,
    code: string,
    violationCount: number,
  ): string[] {
    if (category === 'conflict') {
      return [
        this.t('problem.step.conflictReview'),
        this.t('problem.step.conflictUpdate'),
        this.t('problem.step.support'),
      ];
    }
    if (category === 'import' || code === 'INT-400') {
      return [
        this.t('problem.step.importReview'),
        this.t('problem.step.importTemplate'),
        this.t('problem.step.retry'),
      ];
    }
    return [
      violationCount > 0 ? this.t('problem.step.fixListed') : this.t('problem.step.fixHighlighted'),
      this.t('problem.step.keepIdentifiers'),
      this.t('problem.step.retry'),
    ];
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
