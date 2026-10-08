import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController,provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { I18nService } from '../../../core/i18n.service';
import { ToastService } from '../../../shared/toast.service';
import { AiMigrationPage } from './ai-migration';
describe('AI source archive and request recovery',()=>{
 let http:HttpTestingController,page:any;
 beforeEach(()=>{TestBed.configureTestingModule({providers:[provideHttpClient(),provideHttpClientTesting(),{provide:I18nService,useValue:{t:(k:string)=>k,lang:()=> 'en'}},{provide:ToastService,useValue:{errorFrom:()=>{},success:()=>{}}}]});http=TestBed.inject(HttpTestingController);page=TestBed.runInInjectionContext(()=>new AiMigrationPage());});
 afterEach(()=>http.verify());
 it('requests complete archive paging and search',async()=>{page.archiveSearch='بحث';const work=page.load(5);http.expectOne('/api/ai/migration-previews/context').flush({canPropose:true});const r=http.expectOne(x=>x.url==='/api/ai/migration-previews');expect(r.request.params.get('pageSize')).toBe('25');expect(r.request.params.get('page')).toBe('5');expect(r.request.params.get('search')).toBe('بحث');r.flush({data:[{id:'last'}],total:101,page:5,pageSize:25,totalPages:5});await work;expect(page.archive().data[0].id).toBe('last');});
 it('preserves the request key after a transport failure and changes it for new intent',async()=>{page.context.set({canPropose:true});page.justification.set('source proposal');page.evidence.set('123');const first=page.create(),one=http.expectOne('/api/ai/migration-previews'),key=one.request.body.requestKey;one.flush({},{status:503,statusText:'failure'});await first;const second=page.create(),two=http.expectOne('/api/ai/migration-previews');expect(two.request.body.requestKey).toBe(key);two.flush({},{status:503,statusText:'failure'});await second;page.justification.set('changed intent');const third=page.create(),three=http.expectOne('/api/ai/migration-previews');expect(three.request.body.requestKey).not.toBe(key);three.flush({},{status:503,statusText:'failure'});await third;});
 it('ignores a stale archive success after a newer search',async()=>{const a=page.load(),context1=http.expectOne('/api/ai/migration-previews/context'),old=http.expectOne(x=>x.url==='/api/ai/migration-previews');page.archiveSearch='new';const b=page.load(),context2=http.expectOne('/api/ai/migration-previews/context'),latest=http.expectOne(x=>x.url==='/api/ai/migration-previews');context2.flush({canPropose:true});latest.flush({data:[{id:'new'}]});await b;context1.flush({canPropose:true});old.flush({data:[{id:'old'}]});await a;expect(page.archive().data[0].id).toBe('new');});
});
