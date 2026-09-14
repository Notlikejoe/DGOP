import { ChangeDetectionStrategy, Component, effect, inject, input, output, signal } from '@angular/core';
import { DatePipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { HttpClient } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';
import { TableModule } from 'primeng/table';
import { I18nService } from '../../../core/i18n.service';
import { ToastService } from '../../../shared/toast.service';
interface StrategyContext {
 version:number;strategyCode:string|null;referencesCurrent:boolean;task:{role:string;stage:string}|null;
 canPropose:boolean;canReview:boolean;canReturn:boolean;canClose:boolean;canOpenEscalation:boolean;canResolveEscalation:boolean;canAdvance:boolean;
 escalation:{code:string;level:string;status:string}|null;
 events:Array<{id:string;kind:string;outcome:string;actorRoleCode:string;justification:string;evidenceIds:string[];createdAt:string;payload:{scopeChange?:string}}>;
}
@Component({selector:'app-ai-risk-strategy',standalone:true,imports:[FormsModule,DatePipe,TableModule],templateUrl:'./ai-risk-strategy.html',
 styleUrls:['../ai-review/ai-review.scss','./ai-risk-assessment.scss'],changeDetection:ChangeDetectionStrategy.OnPush})
export class AiRiskStrategy {
 readonly riskId=input.required<string>();readonly updated=output<void>();private readonly http=inject(HttpClient);private readonly toast=inject(ToastService);protected readonly i18n=inject(I18nService);
 protected readonly context=signal<StrategyContext|null>(null);protected readonly working=signal(false);protected readonly failed=signal(false);private sequence=0;
 protected justification='';protected evidence='';protected scopeChange='';protected avoidanceAction='scope_change';
 constructor(){effect(()=>{void this.load(this.riskId());});}
 protected t(key:string){return this.i18n.t(key);}
 protected async load(id=this.riskId()){
  const sequence=++this.sequence;this.context.set(null);this.failed.set(false);
  try{const c=await firstValueFrom(this.http.get<StrategyContext>(`/api/ai/risks/${id}/strategy`));if(sequence!==this.sequence)return;this.context.set(c);this.justification='';this.evidence='';this.scopeChange='';}
  catch(e){if(sequence===this.sequence){this.failed.set(true);this.toast.errorFrom(e,this.t('aiAdoption.error'));}}
 }
 protected async act(action:string){
  const c=this.context();if(!c||this.working()||!this.justification.trim()||!this.evidence.trim())return;
  const id=this.riskId();this.working.set(true);
  try{await firstValueFrom(this.http.post(`/api/ai/risks/${id}/strategy`,{expectedVersion:c.version,action,justification:this.justification.trim(),evidenceIds:[...new Set(this.evidence.split(/[\s,;]+/u).filter(Boolean))],...(action==='propose'?{avoidanceAction:this.avoidanceAction,scopeChange:this.scopeChange.trim()}:{})}));this.toast.success(this.t('aiAdoption.saved'));this.updated.emit();await this.load(id);}
  catch(e){this.toast.errorFrom(e,this.t('aiAdoption.error'));await this.load(id);}finally{this.working.set(false);}
 }
}
