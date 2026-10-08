import {provideHttpClient} from '@angular/common/http';
import {HttpTestingController,provideHttpClientTesting} from '@angular/common/http/testing';
import {TestBed} from '@angular/core/testing';
import {AuthService} from '../core/auth.service';
import {I18nService} from '../core/i18n.service';
import {ToastService} from './toast.service';
import {AiRequestControls} from './ai-request-controls';

describe('Independent AI request controls',()=>{
 let permissions:Set<string>,http:HttpTestingController;
 beforeEach(()=>{
  permissions=new Set();
  TestBed.configureTestingModule({imports:[AiRequestControls],providers:[provideHttpClient(),provideHttpClientTesting(),
   {provide:AuthService,useValue:{hasAiPermission:(permission:string)=>permissions.has(permission)}},
   {provide:I18nService,useValue:{t:(key:string)=>key,lang:()=> 'en'}},
   {provide:ToastService,useValue:{success:()=>{},errorFrom:()=>{}}},
  ]});http=TestBed.inject(HttpTestingController);
 });
 afterEach(()=>http.verify());
 function mount(){const fixture=TestBed.createComponent(AiRequestControls);fixture.componentRef.setInput('useCaseId','visible-case');fixture.componentRef.setInput('version',1);fixture.detectChanges();return fixture;}
 it('platform oversight loads no business action contexts',()=>{
  const fixture=mount();http.expectNone(()=>true);expect(fixture.nativeElement.textContent.trim()).toBe('');
 });
 it('requester capability loads closure without requesting higher authority reversal',()=>{
  permissions.add('case.create.aiuc');mount();
  http.expectOne('/api/ai/use-cases/visible-case/closure').flush({version:1,canWithdraw:false,canCloseNoAction:false,informationDueAt:null});
  http.expectNone('/api/ai/use-cases/classification/visible-case/reversal');
 });
 it('higher authority capability loads reversal without requesting requester closure',()=>{
  permissions.add('aiuc.classify.reverse');mount();
  http.expectOne('/api/ai/use-cases/classification/visible-case/reversal').flush({version:1,canReverse:false,calculatedTierCode:null,approvedTierCode:null,scoreMax:null});
  http.expectNone('/api/ai/use-cases/visible-case/closure');
 });
});
