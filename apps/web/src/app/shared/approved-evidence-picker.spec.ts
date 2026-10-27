import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting, HttpTestingController } from '@angular/common/http/testing';
import { ApprovedEvidencePicker } from './approved-evidence-picker';
import { AuthService } from '../core/auth.service';
import { I18nService } from '../core/i18n.service';
describe('ApprovedEvidencePicker', () => {
  let allowed = true,
    http: HttpTestingController;
  beforeEach(() => {
    allowed = true;
    TestBed.configureTestingModule({
      imports: [ApprovedEvidencePicker],
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        { provide: AuthService, useValue: { hasPermission: () => allowed } },
        { provide: I18nService, useValue: { lang: () => 'en', t: (key: string) => key } },
      ],
    });
    http = TestBed.inject(HttpTestingController);
  });
  afterEach(() => http.verify());
  it('makes no optional protected request without evidence permission', () => {
    allowed = false;
    const f = TestBed.createComponent(ApprovedEvidencePicker);
    f.detectChanges();
    http.expectNone((request) => request.url.includes('approved-options'));
    expect(f.nativeElement.textContent).toContain('requires evidence viewing access');
  });
  it('cancels an older search and disables documents whose original cannot be verified', () => {
    const f = TestBed.createComponent(ApprovedEvidencePicker),
      c = f.componentInstance as any;
    f.detectChanges();
    const old = http.expectOne((request) => request.url.endsWith('approved-options'));
    c.search.set('qualification');
    c.load(1);
    expect(old.cancelled).toBe(true);
    http
      .expectOne((request) => request.params.get('search') === 'qualification')
      .flush({
        data: [{ id: 'missing', title: 'Unavailable', fileAvailability: 'unavailable' }],
        total: 1,
        page: 1,
      });
    f.detectChanges();
    expect(
      (f.nativeElement.querySelector('option[value=missing]') as HTMLOptionElement).disabled,
    ).toBe(true);
  });
});
