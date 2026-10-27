import { TestBed } from '@angular/core/testing';
import { RegisterControls } from './register-controls';
import { I18nService } from '../core/i18n.service';
describe('RegisterControls', () => {
  beforeEach(() =>
    TestBed.configureTestingModule({
      imports: [RegisterControls],
      providers: [
        { provide: I18nService, useValue: { lang: () => 'en', t: (key: string) => key } },
      ],
    }),
  );
  it('starts a submitted search on page one and does not apply unfinished typing during pagination', () => {
    const f = TestBed.createComponent(RegisterControls),
      c = f.componentInstance as any,
      queries: any[] = [];
    c.queryChange.subscribe((query: any) => queries.push(query));
    f.componentRef.setInput('total', 201);
    f.detectChanges();
    c.draft.set('payroll');
    c.submit();
    expect(queries[0]).toEqual({ page: 1, search: 'payroll' });
    c.draft.set('unfinished');
    const next = Array.from(f.nativeElement.querySelectorAll('button')).find((b: any) =>
      b.textContent.includes('pager.next'),
    ) as HTMLButtonElement;
    next.click();
    expect(queries[1]).toEqual({ page: 2, search: 'payroll' });
  });
});
