import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting, HttpTestingController } from '@angular/common/http/testing';
import { BusinessValuePage } from './business-value';
import { I18nService } from '../../../core/i18n.service';
import { ToastService } from '../../../shared/toast.service';
import { AuthService } from '../../../core/auth.service';
describe('BusinessValuePage integrity', () => {
  let http: HttpTestingController;
  beforeEach(() => {
    TestBed.configureTestingModule({
      imports: [BusinessValuePage],
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        { provide: I18nService, useValue: { lang: () => 'en', t: (key: string) => key } },
        { provide: ToastService, useValue: { errorFrom: () => {} } },
        { provide: AuthService, useValue: { hasPermission: () => false } },
      ],
    });
    http = TestBed.inject(HttpTestingController);
  });
  afterEach(() => http.verify());
  function fixture() {
    const f = TestBed.createComponent(BusinessValuePage);
    f.detectChanges();
    http.expectOne('/api/assets').flush([]);
    http.expectOne('/api/data-domains').flush([]);
    const registerPages = Object.fromEntries(
      ['glossary', 'lineage', 'valuations', 'lifecycle', 'assessments', 'kpis', 'surveys'].map(
        (key) => [key, { data: [], total: 201, page: 1, pageSize: 25, totalPages: 9 }],
      ),
    );
    http
      .expectOne('/api/business-value/workspace')
      .flush({
        summary: {
          glossary: { readinessScore: 50, total: 201 },
          lineageMaps: 0,
          lifecyclePending: 0,
          totalAnnualValue: 20100,
        },
        graph: { nodes: [], edges: [] },
        glossary: [],
        lineage: [],
        valuations: [],
        lifecycle: [],
        assessments: [],
        kpis: [],
        surveys: [],
        registerPages,
      });
    return f;
  }
  it('cancels stale register results and retains complete summary totals', () => {
    const f = fixture(),
      c = f.componentInstance as any;
    c.loadRegister('valuations', { page: 1, search: 'Finance' });
    const old = http.expectOne((request) => request.url.endsWith('/registers/valuations'));
    c.loadRegister('valuations', { page: 1, search: 'HR' });
    expect(old.cancelled).toBe(true);
    http
      .expectOne((request) => request.params.get('search') === 'HR')
      .flush({ data: [{ id: 'hr' }], total: 1, page: 1, pageSize: 25, totalPages: 1 });
    expect(c.workspace().valuations).toEqual([{ id: 'hr' }]);
    expect(c.workspace().summary.totalAnnualValue).toBe(20100);
  });
  it('keeps a failed measured-outcome form and its values without retrying the write', () => {
    const f = fixture(),
      c = f.componentInstance as any;
    c.openMeasurement({ id: 'v1', version: 2, useCase: 'Forecast' });
    c.measurementDraft = {
      actualAnnualValue: 100,
      measuredAt: '2026-01-01',
      evidenceId: 'proof',
      evidenceJustification: 'Evidence supports this exact outcome',
    };
    c.recordMeasurement();
    const request = http.expectOne('/api/business-value/valuations/v1/measure');
    expect(request.request.body.expectedVersion).toBe(2);
    request.flush({ message: 'Changed; reload' }, { status: 409, statusText: 'Conflict' });
    expect(c.measurementTarget().id).toBe('v1');
    expect(c.measurementDraft.actualAnnualValue).toBe(100);
    http.expectNone('/api/business-value/valuations/v1/measure');
  });
});
