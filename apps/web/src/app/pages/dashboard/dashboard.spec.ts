import {provideHttpClient} from '@angular/common/http';
import {HttpTestingController,provideHttpClientTesting} from '@angular/common/http/testing';
import {provideRouter} from '@angular/router';
import {TestBed} from '@angular/core/testing';
import {AuthService} from '../../core/auth.service';
import {I18nService} from '../../core/i18n.service';
import {Dashboard} from './dashboard';

describe('Dashboard permission contract',()=>{
 let allowed:boolean,http:HttpTestingController;
 beforeEach(()=>{
  allowed=false;
  TestBed.configureTestingModule({imports:[Dashboard],providers:[provideHttpClient(),provideHttpClientTesting(),provideRouter([]),
   {provide:AuthService,useValue:{hasPermission:(permission:string)=>allowed&&permission==='dashboard.view'}},
   {provide:I18nService,useValue:{t:(key:string)=>key,lang:()=> 'en'}},
  ]});http=TestBed.inject(HttpTestingController);
 });
 afterEach(()=>http.verify());
 it('a limited role gets a stable empty home without calling a forbidden summary',()=>{
  const fixture=TestBed.createComponent(Dashboard);fixture.detectChanges();
  http.expectOne('/api/health').flush({status:'ok',database:{status:'up'}});
  http.expectNone('/api/dashboard/summary');fixture.detectChanges();
  expect(fixture.nativeElement.querySelector('.empty-state')).toBeTruthy();
  expect(fixture.nativeElement.textContent).toContain('db.empty');
 });
 it('dashboard readers load their scoped summary and surface genuine server errors',()=>{
  allowed=true;const fixture=TestBed.createComponent(Dashboard);fixture.detectChanges();
  http.expectOne('/api/health').flush({status:'ok',database:{status:'up'}});
  http.expectOne('/api/dashboard/summary').flush({}, {status:503,statusText:'Unavailable'});fixture.detectChanges();
  expect(fixture.nativeElement.textContent).toContain('cmd.dashboardUnavailable');
 });
});
