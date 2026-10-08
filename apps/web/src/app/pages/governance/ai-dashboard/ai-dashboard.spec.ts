import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController,provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { I18nService } from '../../../core/i18n.service';
import { ToastService } from '../../../shared/toast.service';
import { AiDashboardPage } from './ai-dashboard';
describe('AI dashboard complete paging and stale responses',()=>{
 let http:HttpTestingController,page:any,errors:unknown[];
 beforeEach(()=>{errors=[];TestBed.configureTestingModule({providers:[provideHttpClient(),provideHttpClientTesting(),{provide:I18nService,useValue:{t:(k:string)=>k,lang:()=> 'en'}},{provide:ToastService,useValue:{errorFrom:(e:unknown)=>errors.push(e)}}]});http=TestBed.inject(HttpTestingController);page=TestBed.runInInjectionContext(()=>new AiDashboardPage());});
 afterEach(()=>http.verify());
 const result=(id:string)=>({data:[{id,title:id,reference:id}],total:101,page:5,pageSize:25,totalPages:5});
 it('uses the standard envelope and requests page five with Arabic server search',async()=>{page.currentFilter='registered';page.detailSearch='بحث';const work=page.openDetails('registered',5),r=http.expectOne(x=>x.url.endsWith('/drilldown'));expect(r.request.params.get('search')).toBe('بحث');expect(r.request.params.get('pageSize')).toBe('25');expect(r.request.params.get('page')).toBe('5');r.flush(result('last'));await work;expect(page.drilldown().data[0].id).toBe('last');expect(page.drilldown().total).toBe(101);});
 it('ignores an older success after a newer filter',async()=>{const a=page.openDetails('registered'),old=http.expectOne(x=>x.url.endsWith('/drilldown')),b=page.openDetails('identified'),latest=http.expectOne(x=>x.url.endsWith('/drilldown'));latest.flush(result('new'));await b;old.flush(result('old'));await a;expect(page.drilldown().data[0].id).toBe('new');});
 it('ignores a stale failure after closing details',async()=>{const a=page.openDetails('registered'),old=http.expectOne(x=>x.url.endsWith('/drilldown'));page.closeDetails();old.flush({},{status:500,statusText:'old'});await a;expect(page.drilldown()).toBeNull();expect(page.detailsState()).toBe('idle');expect(errors).toEqual([]);});
});
