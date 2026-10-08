import {provideHttpClient} from '@angular/common/http';
import {HttpTestingController,provideHttpClientTesting} from '@angular/common/http/testing';
import {TestBed} from '@angular/core/testing';
import {AuthService} from '../core/auth.service';
import {I18nService} from '../core/i18n.service';
import {AiAuditQuery} from './ai-audit-query';

describe('Native AI audit visibility',()=>{
 let permissions:Set<string>,http:HttpTestingController;
 beforeEach(()=>{
  permissions=new Set();TestBed.configureTestingModule({imports:[AiAuditQuery],providers:[provideHttpClient(),provideHttpClientTesting(),
   {provide:AuthService,useValue:{hasAiPermission:(permission:string)=>permissions.has(permission),hasAnyRole:()=>false}},
   {provide:I18nService,useValue:{t:(key:string)=>key,lang:()=> 'en'}},
  ]});http=TestBed.inject(HttpTestingController);
 });
 afterEach(()=>http.verify());
 function mount(kind:'airs'|'aiuc'|'all'){const fixture=TestBed.createComponent(AiAuditQuery);fixture.componentRef.setInput('caseId','visible-case');fixture.componentRef.setInput('kind',kind);fixture.detectChanges();return fixture;}
 it('an own-record reader opens the record without requesting broader audit metadata',()=>{
  permissions.add('case.view.airs.own');const fixture=mount('airs');http.expectNone('/api/ai/audit');expect(fixture.nativeElement.textContent.trim()).toBe('');
 });
 it('a scoped organization reader requests only its permitted audit kind',()=>{
  permissions.add('case.view.airs.org');mount('airs');http.expectOne(request=>request.url==='/api/ai/audit'&&request.params.get('kind')==='airs'&&request.params.get('detail')==='redacted').flush({rows:[],total:0,page:1,pageSize:20});
 });
 it('an all-kind query requires both register capabilities',()=>{
  permissions.add('case.view.airs.all');const fixture=mount('all');http.expectNone('/api/ai/audit');expect(fixture.nativeElement.textContent.trim()).toBe('');
 });
});
