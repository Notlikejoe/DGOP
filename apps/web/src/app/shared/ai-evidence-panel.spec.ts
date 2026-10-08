import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { AiEvidencePanel } from './ai-evidence-panel';
import { I18nService } from '../core/i18n.service';
import { ToastService } from './toast.service';
describe('AI evidence panel',()=>{
 let http:HttpTestingController;
 const page={data:[],total:0,page:1,totalPages:1,canLink:true,links:[],linksTruncated:false};
 beforeEach(()=>{TestBed.configureTestingModule({imports:[AiEvidencePanel],providers:[provideHttpClient(),provideHttpClientTesting(),{provide:I18nService,useValue:{t:(key:string)=>key}},{provide:ToastService,useValue:{errorFrom:()=>undefined}}]});http=TestBed.inject(HttpTestingController);});
 afterEach(()=>http.verify());
 function fixture(){const f=TestBed.createComponent(AiEvidencePanel);f.componentRef.setInput('targetType','ai_risk');f.componentRef.setInput('targetId','risk-a');f.detectChanges();return f;}
 it('checks evidence only when opened',async()=>{const f=fixture();http.expectNone('/api/ai/evidence/ai_risk/risk-a?page=1&pageSize=25');const details=f.nativeElement.querySelector('details') as HTMLDetailsElement;details.open=true;details.dispatchEvent(new Event('toggle'));f.detectChanges();http.expectOne('/api/ai/evidence/ai_risk/risk-a?page=1&pageSize=25').flush(page);await f.whenStable();});
 it('ignores a response belonging to the previous record',async()=>{const f=fixture(),c=f.componentInstance as any;c.opened.set(true);f.detectChanges();const old=http.expectOne('/api/ai/evidence/ai_risk/risk-a?page=1&pageSize=25');f.componentRef.setInput('targetId','risk-b');f.detectChanges();http.expectOne('/api/ai/evidence/ai_risk/risk-b?page=1&pageSize=25').flush({...page,total:2});old.flush({...page,total:99});await f.whenStable();expect(c.page().total).toBe(2);});
 it('posts explicit relevance, unique identifiers and reloads the current record',async()=>{const f=fixture(),c=f.componentInstance as any;c.opened.set(true);f.detectChanges();http.expectOne('/api/ai/evidence/ai_risk/risk-a?page=1&pageSize=25').flush(page);await f.whenStable();c.evidence='id-a, id-a; id-b';c.reason=' Supports this risk ';const done=c.link();const request=http.expectOne('/api/ai/evidence/ai_risk/risk-a/links');expect(request.request.body).toEqual({evidenceIds:['id-a','id-b'],justification:'Supports this risk'});request.flush({});await Promise.resolve();http.expectOne('/api/ai/evidence/ai_risk/risk-a?page=1&pageSize=25').flush(page);await done;expect(c.busy()).toBe(false);});
 it('shows review-needed assurance and keeps linking hidden for an auditor',async()=>{const f=fixture(),c=f.componentInstance as any;c.opened.set(true);f.detectChanges();http.expectOne('/api/ai/evidence/ai_risk/risk-a?page=1&pageSize=25').flush({...page,canLink:false,data:[{id:'legacy',action:'airs.residual.accept_owner.accept',assurance:'review_needed',reasons:['historical_proof_missing'],proof:null}]});await f.whenStable();f.detectChanges();expect(f.nativeElement.textContent).toContain('aiProof.review_needed');expect(f.nativeElement.querySelector('textarea')).toBeNull();});
});
