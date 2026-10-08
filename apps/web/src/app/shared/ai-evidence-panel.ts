import { ChangeDetectionStrategy, Component, effect, inject, input, signal } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { FormsModule } from '@angular/forms';
import { firstValueFrom } from 'rxjs';
import { I18nService } from '../core/i18n.service';
import { ToastService } from './toast.service';
interface EvidencePage {
 data:Array<{id:string;action:string;assurance:string;reasons:string[];proof:{digest:string}|null}>;
 total:number;page:number;totalPages:number;canLink:boolean;linksTruncated:boolean;
 links:Array<{id:string;evidenceId:string;title:string;demoOnly:boolean;exclusion:string|null}>;
}
@Component({selector:'app-ai-evidence-panel',standalone:true,imports:[FormsModule],changeDetection:ChangeDetectionStrategy.OnPush,
 template:`<details class="proof-panel" (toggle)="toggle($event)"><summary>{{t('aiProof.title')}}</summary>
 <p>{{t('aiProof.instructions')}}</p>
 @if(error()){<p role="alert">{{t('aiProof.error')}}</p>}
 @if(page();as p){
 @for(link of p.links;track link.id){<p><strong>{{link.title}}</strong> · <code>{{link.evidenceId}}</code> · {{link.exclusion?t('aiProof.review_needed'):link.demoOnly?t('aiProof.demo_verified'):t('aiProof.verified')}}</p>}
 @if(p.linksTruncated){<p>{{t('aiProof.linksLimit')}}</p>}
 @if(p.canLink){<label>{{t('aiProof.ids')}}<textarea rows="2" [(ngModel)]="evidence" maxlength="800"></textarea></label>
 <label>{{t('aiProof.reason')}}<textarea rows="2" [(ngModel)]="reason" maxlength="5000"></textarea></label>
 <button type="button" class="ds-btn ds-btn--primary" [disabled]="busy()||!evidence.trim()||!reason.trim()" (click)="link()">{{t('aiProof.link')}}</button>}
 @for(row of p.data;track row.id){<article><strong>{{row.action}}</strong> · <span [class.needs-review]="row.assurance==='review_needed'">{{t('aiProof.'+row.assurance)}}</span>
 @for(reason of row.reasons;track reason){<p>{{t('aiProof.reason.'+reason)}}</p>}
 @if(row.proof){<small>{{t('aiProof.digest')}} <code>{{row.proof.digest}}</code></small>}</article>}
 <div class="proof-pager"><button type="button" class="ds-btn" [disabled]="busy()||p.page<=1" (click)="load(p.page-1)">{{t('aiProof.previous')}}</button><span>{{p.page}} / {{p.totalPages}} · {{p.total}}</span><button type="button" class="ds-btn" [disabled]="busy()||p.page>=p.totalPages" (click)="load(p.page+1)">{{t('aiProof.next')}}</button></div>
 }<button type="button" class="ds-btn" [disabled]="busy()" (click)="load()">{{t('crud.retry')}}</button></details>`,
 styles:[`:host{display:block;min-inline-size:0;margin-block:1rem}.proof-panel{border:1px solid var(--border-color,#68788a);padding:1rem;border-radius:.75rem;overflow-wrap:anywhere}summary{cursor:pointer;font-weight:600}label{display:block;margin-block:.75rem}textarea{display:block;inline-size:100%;box-sizing:border-box;background:transparent;color:inherit;border:1px solid var(--border-color,#68788a);border-radius:.4rem;padding:.5rem}article{padding-block:.6rem;border-block-end:1px solid var(--border-color,#68788a)}.proof-pager{display:flex;align-items:center;gap:.6rem;flex-wrap:wrap;margin-block:.8rem}.needs-review{font-weight:700;color:var(--orange-500,#cb7700)}code{font-size:.85em}`]})
export class AiEvidencePanel {
 readonly targetType=input.required<string>();readonly targetId=input.required<string>();
 private readonly http=inject(HttpClient);private readonly i18n=inject(I18nService);private readonly toast=inject(ToastService);
 protected readonly page=signal<EvidencePage|null>(null);protected readonly busy=signal(false);protected readonly error=signal(false);
 protected evidence='';protected reason='';private generation=0;private readonly opened=signal(false);
 constructor(){effect(()=>{this.targetType();this.targetId();this.evidence='';this.reason='';this.page.set(null);++this.generation;this.busy.set(false);if(this.opened())void this.load();});}
 protected toggle(event:Event){this.opened.set((event.target as HTMLDetailsElement).open);}
 protected t(key:string){return this.i18n.t(key);}
 private url(){return '/api/ai/evidence/'+encodeURIComponent(this.targetType())+'/'+encodeURIComponent(this.targetId());}
 protected async load(page=1){const generation=++this.generation;this.busy.set(true);this.error.set(false);try{const result=await firstValueFrom(this.http.get<EvidencePage>(this.url()+'?page='+page+'&pageSize=25'));if(generation===this.generation)this.page.set(result);}catch{if(generation===this.generation)this.error.set(true);}finally{if(generation===this.generation)this.busy.set(false);}}
 protected async link(){if(this.busy())return;const url=this.url(),generation=this.generation;this.busy.set(true);try{await firstValueFrom(this.http.post(url+'/links',{evidenceIds:[...new Set(this.evidence.split(/[\s,;]+/u).filter(Boolean))],justification:this.reason.trim()}));if(generation===this.generation){this.evidence='';this.reason='';await this.load();}}catch(e){if(generation===this.generation)this.toast.errorFrom(e,this.t('aiProof.error'));}finally{if(generation===this.generation)this.busy.set(false);}}
}
