import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting, TestRequest } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { AuthService } from '../../../core/auth.service';
import { I18nService } from '../../../core/i18n.service';
import { ToastService } from '../../../shared/toast.service';
import { AiReviewPage } from './ai-review';

describe('AI review server queues and request ordering',()=>{
  let http:HttpTestingController,page:any,errors:unknown[];
  beforeEach(()=>{
    vi.stubGlobal('ResizeObserver',class { observe(){} unobserve(){} disconnect(){} });
    errors=[];
    TestBed.configureTestingModule({imports:[AiReviewPage],providers:[provideHttpClient(),provideHttpClientTesting(),
      {provide:AuthService,useValue:{hasAiPermission:()=>true,currentUser:()=>({id:'reviewer',roles:[]}),aiCapabilities:()=>null}},
      {provide:I18nService,useValue:{t:(key:string)=>key,lang:()=> 'en'}},
      {provide:ToastService,useValue:{errorFrom:(error:unknown)=>errors.push(error)}},
    ]});
    http=TestBed.inject(HttpTestingController);
    page=TestBed.runInInjectionContext(()=>new AiReviewPage());
  });
  afterEach(()=>{page.ngOnDestroy();http.verify();vi.useRealTimers();vi.unstubAllGlobals();});
  function flush(requests:TestRequest[],name='current',overrides:Record<string,unknown>={}) {
    for(const req of requests){
      if(req.request.url.endsWith('queue')||req.request.url.endsWith('/triage')){
        const number=Number(req.request.params.get('page'));
        req.flush({data:[{id:name,name,workflowCase:{id:'case',code:'AIUC',tasks:[]},intakeRevisions:[],assessments:[]}],
          total:101,page:number,pageSize:25,totalPages:5,summary:{total:101,pending:100,inProgress:1,overdue:50},...overrides});
      }else if(req.request.url.endsWith('configuration'))req.flush({ready:true,scores:[],tiers:[],criteria:[],issues:[]});
      else if(req.request.url.endsWith('registration/lookups'))req.flush({domains:[],classifications:[]});
      else req.flush({});
    }
  }
  it('uses complete server totals and bounded server search, without filtering a partial page',async()=>{
    page.queueSearch.set('عربي');const work=page.load();const requests=http.match(()=>true);
    for(const req of requests.filter(req=>req.request.url.endsWith('queue')||req.request.url.endsWith('/triage'))){
      expect(req.request.params.get('search')).toBe('عربي');expect(req.request.params.get('pageSize')).toBe('25');
    }
    flush(requests,'server match');await work;
    expect(page.totalAssigned()).toBe(606);expect(page.assessmentCount()).toBe(303);expect(page.approvalCount()).toBe(202);
    expect(page.filteredActiveCases().length).toBe(1);
  });
  it('discards older successful responses after a newer search has completed',async()=>{
    const old=page.load(),older=http.match(()=>true);
    page.queueSearch.set('new');const latest=page.load(),newer=http.match(()=>true);
    flush(newer,'latest');await latest;flush(older,'old');await old;
    expect(page.selected().id).toBe('latest');expect(page.state()).toBe('ok');expect(errors.length).toBe(0);
  });
  it('keeps the latest tab and ignores an older infrastructure error',async()=>{
    const old=page.load(),older=http.match(()=>true);page.setTab('decision');const newer=http.match(()=>true);
    flush(newer,'decision');await vi.waitFor(()=>expect(page.state()).toBe('ok'));
    older[0].flush({message:'old outage'},{status:500,statusText:'failure'});flush(older.slice(1),'old');await old;
    expect(page.tab()).toBe('decision');expect(page.selected().id).toBe('decision');expect(page.state()).toBe('ok');expect(errors.length).toBe(0);
  });
  it('represents a denied queue separately from an empty queue',async()=>{
    const work=page.load(),requests=http.match(()=>true),denied=requests.find(req=>req.request.url.includes('/reviews/queue'))!;
    denied.flush({message:'denied'},{status:403,statusText:'Forbidden'});flush(requests.filter(req=>req!==denied));await work;
    expect(page.queues().specialist.denied).toBe(true);expect(page.queues().specialist.total).toBe(0);expect(page.state()).toBe('ok');
  });
  it('rejects a legacy array rather than displaying misleading counts',async()=>{
    const work=page.load(),requests=http.match(()=>true);requests[0].flush([]);flush(requests.slice(1));await work;
    expect(page.state()).toBe('error');expect(errors.length).toBe(1);
  });
  it('debounces search and resets all pages before requesting the final term',async()=>{
    vi.useFakeTimers();page.queuePages.set({triage:5,decision:4});
    page.changeQueueSearch('old');page.changeQueueSearch('final');expect(http.match(()=>true).length).toBe(0);
    await vi.advanceTimersByTimeAsync(250);const requests=http.match(()=>true);
    expect(requests.length).toBe(9);
    for(const req of requests.filter(req=>req.request.url.endsWith('queue')||req.request.url.endsWith('/triage'))){
      expect(req.request.params.get('search')).toBe('final');expect(req.request.params.get('page')).toBe('1');
    }
    flush(requests);await Promise.resolve();await Promise.resolve();
    expect(page.queuePages()).toEqual({});
  });
  it('moves an emptied last page to the remaining last page',async()=>{
    page.queuePages.set({triage:5});const work=page.load(),requests=http.match(()=>true);
    flush(requests,'old',{total:26,totalPages:2,summary:{total:26,pending:26,inProgress:0,overdue:0}});
    await vi.waitFor(()=>expect(page.queuePages().triage).toBe(2));
    const followup=http.match(()=>true);expect(followup.length).toBe(9);
    expect(followup[0].request.params.get('page')).toBe('2');flush(followup,'corrected');await work;
    expect(page.activeQueue().page).toBe(2);expect(page.selected().id).toBe('corrected');
  });
  it('keeps the focused search input mounted while a search is pending',async()=>{
    const fixture=TestBed.createComponent(AiReviewPage);page=fixture.componentInstance;fixture.detectChanges();
    flush(http.match(()=>true));await vi.waitFor(()=>expect(page.state()).toBe('ok'));fixture.detectChanges();
    const input=fixture.nativeElement.querySelector('.queue-search input') as HTMLInputElement;expect(input).toBeTruthy();input.focus();
    page.changeQueueSearch('still typing');fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('.queue-search input')).toBe(input);expect(document.activeElement).toBe(input);
    expect(page.loadingQueues()).toBe(true);page.ngOnDestroy();fixture.destroy();
  });
});
