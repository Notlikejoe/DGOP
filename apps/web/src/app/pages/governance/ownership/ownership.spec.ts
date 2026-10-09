import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { AuthService } from '../../../core/auth.service';
import { I18nService } from '../../../core/i18n.service';
import { ToastService } from '../../../shared/toast.service';
import { ConfirmService } from '../../../shared/confirm.service';
import { OwnershipPage } from './ownership';

describe('Ownership optional references', () => {
  let http: HttpTestingController;
  beforeEach(() => {
    TestBed.configureTestingModule({providers:[provideHttpClient(),provideHttpClientTesting(),
      {provide:AuthService,useValue:{hasPermission:(p:string)=>p!=='users.view'}},
      {provide:I18nService,useValue:{lang:signal('en'),t:(key:string)=>key}},
      {provide:ToastService,useValue:{errorFrom:()=>{},error:()=>{},success:()=>{}}},
      {provide:ConfirmService,useValue:{confirm:async()=>false}},
    ]}); http=TestBed.inject(HttpTestingController);
  });
  afterEach(()=>http.verify());
  it('loads authorized assignments without requesting a restricted user directory', () => {
    const fixture=TestBed.createComponent(OwnershipPage);fixture.componentInstance.ngOnInit();
    const requests=http.match(()=>true);requests.forEach(r=>r.flush([]));
    expect(requests.some(r=>r.request.url==='/api/users')).toBe(false);
  });
  it('retains the authorized list and disables dependent forms when people cannot load', () => {
    const fixture=TestBed.createComponent(OwnershipPage);fixture.componentInstance.ngOnInit();
    const requests=http.match(()=>true);requests.forEach(r=>r.request.url==='/api/people'
      ? r.flush({}, {status:503,statusText:'Unavailable'}) : r.flush([]));
    const page=fixture.componentInstance as unknown as {state:()=>string;formReferencesReady:()=>boolean};
    expect(page.state()).toBe('ok');expect(page.formReferencesReady()).toBe(false);
  });
});
