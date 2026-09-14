import { ChangeDetectionStrategy, Component, effect, inject, input, output, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { HttpClient } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';
import { TableModule } from 'primeng/table';
import { I18nService } from '../../../core/i18n.service';
import { ToastService } from '../../../shared/toast.service';
import { DualDatePipe } from '../../../shared/dual-date.pipe';
interface SeverityContext {
 version:number;calculatedSeverityCode:string|null;effectiveSeverityCode:string|null;score:number|null;bandCode:string|null;
 canPropose:boolean;canApprove:boolean;canReturn:boolean;canReverse:boolean;
 pending:{severityCode:string;role:string}|null;
 events:Array<{id:string;kind:string;severityCode:string;previousSeverityCode:string;actorRoleCode:string;createdAt:string;justification:string;evidenceIds:string[]}>;
}
@Component({selector:'app-ai-severity',standalone:true,imports:[FormsModule,TableModule,DualDatePipe],templateUrl:'./ai-severity.html',
 styleUrls:['../ai-review/ai-review.scss','./ai-risk-assessment.scss'],changeDetection:ChangeDetectionStrategy.OnPush})
export class AiSeverity {
 readonly riskId=input.required<string>();readonly updated=output<void>();
 private readonly http=inject(HttpClient);private readonly toast=inject(ToastService);protected readonly i18n=inject(I18nService);
 protected readonly context=signal<SeverityContext|null>(null);protected readonly working=signal(false);protected readonly failed=signal(false);private sequence=0;
 protected severityCode='P2';protected justification='';protected evidence='';
 constructor(){effect(()=>{void this.load(this.riskId());});}
 protected t(key:string){return this.i18n.t(key);}
 protected async load(id=this.riskId()){
  const sequence=++this.sequence;this.context.set(null);this.failed.set(false);
  try{const c=await firstValueFrom(this.http.get<SeverityContext>(`/api/ai/risks/${id}/severity`));if(sequence!==this.sequence)return;this.context.set(c);this.justification='';this.evidence='';}
  catch(e){if(sequence===this.sequence){this.failed.set(true);this.toast.errorFrom(e,this.t('aiAdoption.error'));}}
 }
 protected async act(action:string){
  const c=this.context();if(!c||this.working()||!this.justification.trim()||!this.evidence.trim())return;
  const id=this.riskId();this.working.set(true);
  try{await firstValueFrom(this.http.post(`/api/ai/risks/${id}/severity`,{expectedVersion:c.version,action,justification:this.justification.trim(),
   evidenceIds:[...new Set(this.evidence.split(/[\s,;]+/u).filter(Boolean))],...(action==='propose'?{severityCode:this.severityCode}:{})}));
   this.toast.success(this.t('aiAdoption.saved'));this.updated.emit();await this.load(id);
  }catch(e){this.toast.errorFrom(e,this.t('aiAdoption.error'));await this.load(id);}finally{this.working.set(false);}
 }
}
