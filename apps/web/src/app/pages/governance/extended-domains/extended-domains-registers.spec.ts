import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import {
  provideHttpClientTesting,
  HttpTestingController,
} from '@angular/common/http/testing';
import { ExtendedDomainsPage } from './extended-domains';
import { AuthService } from '../../../core/auth.service';
import { I18nService } from '../../../core/i18n.service';
import { ToastService } from '../../../shared/toast.service';

describe('Extended Domains register responses', () => {
  let http: HttpTestingController;
  beforeEach(() => {
    TestBed.configureTestingModule({
      imports: [ExtendedDomainsPage],
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        { provide: AuthService, useValue: { hasPermission: () => false } },
        {
          provide: I18nService,
          useValue: { lang: () => 'en', t: (key: string) => key },
        },
        { provide: ToastService, useValue: { errorFrom: () => {} } },
      ],
    });
    http = TestBed.inject(HttpTestingController);
  });
  afterEach(() => http.verify());
  function component() {
    const fixture = TestBed.createComponent(ExtendedDomainsPage),
      page = fixture.componentInstance as any;
    const registerPages = Object.fromEntries(
      [
        'matches',
        'goldenRecords',
        'references',
        'certifications',
        'architecture',
      ].map((key) => [
        key,
        { data: [], total: 201, page: 1, pageSize: 25, totalPages: 9 },
      ]),
    );
    page.workspace.set({
      summary: { architectureReviews: 201 },
      mdmMatches: [],
      goldenRecords: [],
      referenceVersions: [],
      certifications: [],
      architectureReviews: [],
      registerPages,
    });
    return { fixture, page };
  }
  it('cancels a stale register response and retains the complete summary', () => {
    const { page } = component();
    page.loadRegister('architecture', { page: 1, search: 'Finance' });
    const old = http.expectOne(
      (request) => request.params.get('search') === 'Finance',
    );
    page.loadRegister('architecture', { page: 2, search: 'HR' });
    expect(old.cancelled).toBe(true);
    http
      .expectOne((request) => request.params.get('search') === 'HR')
      .flush({
        data: [{ id: 'hr' }],
        total: 51,
        page: 2,
        pageSize: 25,
        totalPages: 3,
      });
    expect(page.workspace().architectureReviews).toEqual([{ id: 'hr' }]);
    expect(page.workspace().summary.architectureReviews).toBe(201);
    expect(page.workspace().registerPages.architecture.total).toBe(51);
  });
  it('shows a register-specific error without retrying a failed request automatically', () => {
    const { page } = component();
    page.loadRegister('goldenRecords', { page: 2, search: 'supplier' });
    http
      .expectOne((request) => request.url.endsWith('/registers/goldenRecords'))
      .flush(
        { message: 'Unavailable' },
        { status: 503, statusText: 'Unavailable' },
      );
    expect(page.registerErrors().goldenRecords).toBe(true);
    expect(page.busy().goldenRecords).toBe(false);
    http.expectNone((request) =>
      request.url.endsWith('/registers/goldenRecords'),
    );
  });
  it('cancels pending work on destruction so a removed page cannot restore its state', () => {
    const { page } = component();
    page.loadRegister('references', { page: 1, search: 'classified' });
    const pending = http.expectOne((request) =>
      request.url.endsWith('/registers/references'),
    );
    page.ngOnDestroy();
    expect(pending.cancelled).toBe(true);
  });
});
