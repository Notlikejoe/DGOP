import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { vi } from 'vitest';
import { AuthService } from '../../../core/auth.service';
import { I18nService } from '../../../core/i18n.service';
import { ToastService } from '../../../shared/toast.service';
import { AiReviewPage } from './ai-review';

describe('AI review permission panels',()=>{
  let http:HttpTestingController;
  let panels:Record<string,boolean>;
  beforeEach(()=>{
    panels={triage:true,classification:true,classificationVerification:true,specialist:false,decision:true,registration:false};
    TestBed.configureTestingModule({providers:[provideHttpClient(),provideHttpClientTesting(),
      {provide:AuthService,useValue:{aiCapabilities:()=>({panels}),hasAiPermission:()=>true,hasAiScreen:()=>true}},
      {provide:I18nService,useValue:{lang:signal('en'),t:(key:string)=>key}},
      {provide:ToastService,useValue:{errorFrom:vi.fn(),success:vi.fn()}},
    ]});http=TestBed.inject(HttpTestingController);
  });
  afterEach(()=>http.verify());
  function page(){return TestBed.createComponent(AiReviewPage).componentInstance as unknown as {load:()=>Promise<void>;visibleTabs:()=>string[];state:()=>string;referencesUnavailable:()=>boolean;tab:()=>string};}
  function flush(fail?:string){const requests=http.match(()=>true);for(const request of requests){
    if(request.request.url===fail)request.flush({}, {status:503,statusText:'Unavailable'});
    else if(request.request.url.endsWith('/configuration'))request.flush({ready:true,issues:[],criteria:[],scores:[],tiers:[]});
    else if(request.request.url.endsWith('/lookups'))request.flush({lists:{},proposedOwners:[],dataOwners:[],executiveSponsors:[]});
    else {const page=Number(request.request.params.get('page'));request.flush({data:[],total:0,page,pageSize:25,totalPages:1,summary:{total:0,pending:0,inProgress:0,overdue:0}});}
  }return requests.map(r=>r.request.url);}
  it('never requests or displays registration and specialist panels for the officer profile',async()=>{
    const component=page(),loaded=component.load(),urls=flush();await loaded;
    expect(urls.some(url=>url.includes('/registration/'))).toBe(false);
    expect(urls.some(url=>url.includes('/classification/reviews/'))).toBe(false);
    expect(component.visibleTabs()).toEqual(['triage','classification','verification','decision']);expect(component.state()).toBe('ok');
  });
  it('keeps authorized queues usable when an optional scoring lookup fails',async()=>{
    const component=page(),loaded=component.load();flush('/api/ai/use-cases/classification/configuration');await loaded;
    expect(component.state()).toBe('ok');expect(component.referencesUnavailable()).toBe(true);
  });
  it('loads only the specialist queue for a specialist reviewer',async()=>{
    Object.keys(panels).forEach(key=>panels[key]=key==='specialist');
    const component=page(),loaded=component.load(),urls=flush();await loaded;
    expect(urls.filter(url=>!url.endsWith('/lookups'))).toEqual(['/api/ai/use-cases/classification/reviews/queue']);
    expect(component.visibleTabs()).toEqual(['specialist']);expect(component.tab()).toBe('specialist');
  });
  it('does not present failed authorized queue reads as empty successful queues',async()=>{
    const component=page(),loaded=component.load();flush('/api/ai/use-cases/triage');await loaded;
    expect(component.state()).toBe('error');
  });
});
