import { AiEvidencePanel } from '../../../shared/ai-evidence-panel';
import { ChangeDetectionStrategy, Component, effect, inject, input, output, signal } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { FormsModule } from '@angular/forms';
import { firstValueFrom } from 'rxjs';
import { I18nService } from '../../../core/i18n.service';
import { ToastService } from '../../../shared/toast.service';
import { AppIcon } from '../../../shared/app-icon';
import { StatusChip } from '../../../shared/status-chip';
type Outcome='approve'|'accept'|'restrict'|'stop'|'return';
interface ResidualReviewContext {
  version:number;assessmentId:string|null;round:number|null;bandCode:string|null;score:number|null;adopted:boolean;riskAccepted:boolean;
  operationalStatusCode:string|null;referencesCurrent:boolean;prerequisitesReady:boolean;
  tasks:Array<{id:string;kind:string;roleCode:string;canReturn:boolean;outcomes:Outcome[]}>;
  history:Array<{id:string;round:number;decisions:Array<{id:string;kind:string;decision:Outcome;actorRoleCode:string;justification:string;evidenceIds:string[];conditions:string[]}>}>;
}
@Component({selector:'app-ai-residual-review',standalone:true,imports:[AiEvidencePanel,FormsModule,AppIcon,StatusChip],templateUrl:'./ai-residual-review.html',
  styleUrls:['../ai-review/ai-review.scss','./ai-risk-assessment.scss'],changeDetection:ChangeDetectionStrategy.OnPush})
export class AiResidualReview {
  readonly riskId=input.required<string>();readonly updated=output<void>();
  private readonly http=inject(HttpClient);private readonly i18n=inject(I18nService);private readonly toast=inject(ToastService);
  protected readonly context=signal<ResidualReviewContext|null>(null);protected readonly state=signal<'loading'|'ok'|'error'>('loading');protected readonly working=signal(false);
  protected readonly drafts=signal<Record<string,{justification:string;evidence:string;conditions:string}>>({});private sequence=0;
  constructor(){effect(()=>{void this.load(this.riskId());});}
  protected t(key:string){return this.i18n.t(key);}
  protected patch(id:string,field:'justification'|'evidence'|'conditions',value:string){this.drafts.update(d=>({...d,[id]:{...d[id],[field]:value}}));}
  protected async load(id=this.riskId()) {
    if(id!==this.riskId())return;const sequence=++this.sequence;this.state.set('loading');this.context.set(null);
    try{const c=await firstValueFrom(this.http.get<ResidualReviewContext>(`/api/ai/risks/${id}/residual/review`));if(sequence!==this.sequence)return;
      this.context.set(c);this.drafts.set(Object.fromEntries(c.tasks.map(t=>[t.id,{justification:'',evidence:'',conditions:''}])));this.state.set('ok');
    }catch(e){if(sequence===this.sequence){this.state.set('error');this.toast.errorFrom(e,this.t('aiAdoption.error'));}}
  }
  protected async decide(taskId:string,decision:Outcome) {
    const c=this.context(),task=c?.tasks.find(t=>t.id===taskId),draft=this.drafts()[taskId];
    if(this.working()||!c||!task||!(decision==='return'?task.canReturn:task.outcomes.includes(decision))||!draft?.justification.trim())return;
    const evidenceIds=[...new Set(draft.evidence.split(/[\s,;]+/u).filter(Boolean))];if(!evidenceIds.length)return;
    this.working.set(true);const id=this.riskId();
    try{await firstValueFrom(this.http.post(`/api/ai/risks/${id}/residual/decisions/${taskId}`,{expectedVersion:c.version,decision,justification:draft.justification.trim(),evidenceIds,conditions:draft.conditions.split(/\r?\n/u).map(v=>v.trim()).filter(Boolean)}));
      this.toast.success(this.t('aiAdoption.saved'));this.updated.emit();
    }catch(e){this.toast.errorFrom(e,this.t('aiAdoption.error'));await this.load(id);}finally{this.working.set(false);}
  }
}
