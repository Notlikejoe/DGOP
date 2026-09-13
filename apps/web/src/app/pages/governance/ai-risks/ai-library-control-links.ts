import { ChangeDetectionStrategy, Component, inject, input, effect, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { HttpClient } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';
import { TableModule } from 'primeng/table';
import { I18nService } from '../../../core/i18n.service';
import { ToastService } from '../../../shared/toast.service';
import { AiControlPicker, ControlTag } from './ai-control-picker';
interface LinkVersion {id:string;round:number;digest:string;controlPins:ControlTag[];justification:string;review:{outcome:string;justification:string}|null}
interface LinkContext {categoryMapping:{id:string;controlPins:ControlTag[]}|null;categoryIssue:boolean;canPropose:boolean;canReview:boolean;latestRound:number;controls:ControlTag[];versions:LinkVersion[]}
@Component({selector:'app-ai-library-control-links',standalone:true,imports:[FormsModule,TableModule,AiControlPicker],templateUrl:'./ai-library-control-links.html',styleUrls:['../ai-review/ai-review.scss','../ai-reviews/ai-reviews.scss','./ai-risks.scss'],changeDetection:ChangeDetectionStrategy.OnPush})
export class AiLibraryControlLinks {
 readonly versionId=input.required<string>();private readonly http=inject(HttpClient);protected readonly i18n=inject(I18nService);private readonly toast=inject(ToastService);protected readonly context=signal<LinkContext|null>(null);protected readonly selected=signal<string[]>([]);protected readonly reason=signal('');protected readonly evidence=signal('');protected readonly working=signal(false);protected readonly error=signal(false);private sequence=0;
 constructor(){effect(()=>{void this.load(this.versionId());});}protected t(k:string){return this.i18n.t(k);}
 protected async load(id=this.versionId()){const seq=++this.sequence;this.context.set(null);this.selected.set([]);this.reason.set('');this.evidence.set('');this.error.set(false);try{const c=await firstValueFrom(this.http.get<LinkContext>(`/api/ai/risk-library/versions/${id}/control-links`));if(seq===this.sequence){this.context.set(c);this.selected.set(c.versions.find(v=>v.review?.outcome==='approve')?.controlPins.map(p=>p.versionId)??[]);}}catch(e){if(seq===this.sequence){this.error.set(true);this.toast.errorFrom(e,this.t('aiControls.error'));}}}
 private ids(){return [...new Set(this.evidence().split(/[\s,;]+/u).filter(Boolean))];}
 protected async propose(){const c=this.context();if(!c?.canPropose)return;await this.mutate(`/api/ai/risk-library/versions/${this.versionId()}/control-links`,{expectedRound:c.latestRound,controlVersionIds:this.selected(),justification:this.reason(),evidenceIds:this.ids()});}
 protected async derive(){const c=this.context();if(!c?.canPropose||!c.categoryMapping)return;await this.mutate(`/api/ai/risk-library/versions/${this.versionId()}/control-links`,{expectedRound:c.latestRound,controlVersionIds:[],categoryMappingVersionId:c.categoryMapping.id,justification:this.reason(),evidenceIds:this.ids()});}
 protected async review(v:LinkVersion,outcome:string){await this.mutate(`/api/ai/library-control-links/${v.id}/review`,{expectedDigest:v.digest,outcome,justification:this.reason(),evidenceIds:this.ids()});}
 private async mutate(path:string,body:unknown){if(this.working())return;const id=this.versionId();this.working.set(true);try{await firstValueFrom(this.http.post(path,body));if(id===this.versionId()){this.toast.success(this.t('aiControls.saved'));await this.load(id);}}catch(e){this.toast.errorFrom(e,this.t('aiControls.error'));}finally{this.working.set(false);}}
}
