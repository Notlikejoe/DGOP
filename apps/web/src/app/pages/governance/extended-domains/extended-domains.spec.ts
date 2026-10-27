import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import {
  provideHttpClientTesting,
  HttpTestingController,
} from '@angular/common/http/testing';
import { ExtendedDomainsPage } from './extended-domains';
import { I18nService } from '../../../core/i18n.service';
import { AuthService } from '../../../core/auth.service';
import { ToastService } from '../../../shared/toast.service';

describe('ExtendedDomainsPage decision requests', () => {
  let http: HttpTestingController;
  beforeEach(() => {
    TestBed.configureTestingModule({
      imports: [ExtendedDomainsPage],
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        {
          provide: I18nService,
          useValue: { lang: () => 'en', t: (key: string) => key },
        },
        { provide: AuthService, useValue: { hasPermission: () => false } },
        { provide: ToastService, useValue: { errorFrom: () => {} } },
      ],
    });
    http = TestBed.inject(HttpTestingController);
  });
  afterEach(() => http.verify());
  it('sends the version and exact proof for both linking and approving architecture', () => {
    const c = TestBed.createComponent(ExtendedDomainsPage)
      .componentInstance as any;
    const row = { id: 'review', version: 7, workflowTaskId: 'current-task' };
    c.proofDrafts.review = {
      evidenceId: 'document',
      evidenceJustification: 'Supports this exact review',
    };
    for (const decision of ['pending', 'approved']) {
      c.decideArchitecture(row, decision);
      const request = http.expectOne(
        '/api/extended-domains/architecture/reviews/review/decision',
      );
      expect(request.request.body).toEqual({
        decision,
        expectedVersion: 7,
        workflowTaskId: 'current-task',
        evidenceId: 'document',
        evidenceJustification: 'Supports this exact review',
      });
      request.flush({});
      http.expectOne('/api/extended-domains/workspace').flush({});
    }
  });
  it('retains the separate native reference decision contract', () => {
    const c = TestBed.createComponent(ExtendedDomainsPage)
      .componentInstance as any;
    c.decideReference({ id: 'reference', version: 'v1' }, 'approve');
    const request = http.expectOne(
      '/api/extended-domains/reference/versions/reference/decision',
    );
    expect(request.request.body).toEqual({ decision: 'approve' });
    request.flush({});
    http.expectOne('/api/extended-domains/workspace').flush({});
  });
});
