import { ChangeDetectionStrategy, Component, computed, effect, inject, input, output, signal } from '@angular/core';
import { DatePipe } from '@angular/common';
import { HttpClient } from '@angular/common/http';
import { FormsModule } from '@angular/forms';
import { firstValueFrom } from 'rxjs';
import { I18nService } from '../../../core/i18n.service';
import { ToastService } from '../../../shared/toast.service';
import { AppIcon } from '../../../shared/app-icon';
import { StatusChip } from '../../../shared/status-chip';
interface ReviewContext {
  version:number;cadenceReady:boolean;canRegister:boolean;canRecalculate:boolean;canReassess:boolean;canAddTrigger:boolean;reassessments:Array<{id:string;triggerCode:string;justification:string;evidenceIds:string[];createdAt:string;additionalTriggers:Array<{id:string;triggerCode:string;justification:string;evidenceIds:string[];createdAt:string}>}>;
  history:Array<{id:string;round:number;bandCode:string;intervalDays:number;dueAt:string;anchorAt:string;referenceVersionId:string;cadenceLabelEn:string;cadenceLabelAr:string;cadenceReferenceVersionId:string|null;displayCadenceLabelEn:string|null;displayCadenceLabelAr:string|null;status:'scheduled'|'due_soon'|'overdue'|'completed'|'superseded';canComplete:boolean;signals:Array<{threshold:number;createdAt:string}>;completion:{justification:string;evidenceIds:string[];completedAt:string}|null}>;
}
@Component({selector:'app-ai-risk-monitoring',standalone:true,imports:[FormsModule,DatePipe,AppIcon,StatusChip],templateUrl:'./ai-risk-monitoring.html',
  styleUrls:['../ai-review/ai-review.scss','./ai-risk-assessment.scss','./ai-risk-monitoring.scss'],changeDetection:ChangeDetectionStrategy.OnPush})
export class AiRiskMonitoring {
  readonly riskId=input.required<string>();readonly updated=output<void>();
  private readonly http=inject(HttpClient);protected readonly i18n=inject(I18nService);private readonly toast=inject(ToastService);
  protected readonly context=signal<ReviewContext|null>(null);protected readonly state=signal<'loading'|'ok'|'error'>('loading');protected readonly working=signal(false);
  protected readonly summary=computed(()=>{
    const history=this.context()?.history??[];
    return {current:history.find(r=>['scheduled','due_soon','overdue'].includes(r.status))??null,completed:history.filter(r=>!!r.completion).length};
  });
  protected triggerCode='material_change';protected readonly triggers=['material_change','provider_change','data_change','incident','nonconformity','regulatory_change','detected_deviation'];
  protected justification='';protected evidence='';private sequence=0;
  constructor(){effect(()=>{void this.load(this.riskId());});}
  protected t(key:string){return this.i18n.t(key);}
  protected async load(id=this.riskId()) {
    if(id!==this.riskId())return;const sequence=++this.sequence;this.state.set('loading');this.context.set(null);
    try{const c=await firstValueFrom(this.http.get<ReviewContext>(`/api/ai/risks/${id}/reviews`));if(sequence!==this.sequence)return;this.context.set(c);this.justification='';this.evidence='';this.state.set('ok');}
    catch(e){if(sequence===this.sequence){this.state.set('error');this.toast.errorFrom(e,this.t('aiAdoption.error'));}}
  }
  protected async act(action:'register'|'recalculate'|'complete'|'reassess'|'triggers',reviewId?:string) {
    const c=this.context();if(this.working()||!c||action==='register'&&!c.canRegister||action==='recalculate'&&!c.canRecalculate||action==='reassess'&&!c.canReassess||action==='triggers'&&!c.canAddTrigger||action==='complete'&&!c.history.find(r=>r.id===reviewId)?.canComplete)return;
    const evidenceIds=[...new Set(this.evidence.split(/[\s,;]+/u).filter(Boolean))];
    if((action==='complete'||action==='reassess'||action==='triggers')&&(!this.justification.trim()||!evidenceIds.length))return;
    this.working.set(true);const id=this.riskId();
    try{await firstValueFrom(this.http.post(`/api/ai/risks/${id}/reviews/${action==='complete'?`${reviewId}/complete`:action}`,{expectedVersion:c.version,...(['complete','reassess','triggers'].includes(action)?{justification:this.justification.trim(),evidenceIds}:{}),...(['reassess','triggers'].includes(action)?{triggerCode:this.triggerCode}:{})}));this.toast.success(this.t('aiAdoption.saved'));this.updated.emit();if(action==='recalculate')await this.load(id);}
    catch(e){this.toast.errorFrom(e,this.t('aiAdoption.error'));await this.load(id);}finally{this.working.set(false);}
  }
}
