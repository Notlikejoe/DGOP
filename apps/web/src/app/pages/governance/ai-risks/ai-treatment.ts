import { AiControlPicker, ControlTag } from './ai-control-picker';
import { ChangeDetectionStrategy, Component, effect, inject, input, output, signal } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { FormsModule } from '@angular/forms';
import { firstValueFrom } from 'rxjs';
import { I18nService } from '../../../core/i18n.service';
import { ToastService } from '../../../shared/toast.service';
import { AppIcon } from '../../../shared/app-icon';
import { StatusChip } from '../../../shared/status-chip';
interface ActionForm { controlDomains?:ControlTag[]; title:string; description:string; actionType:string; priorityCode:string; assigneeUserId:string; startDate:string; targetDate:string; evidenceRequired:string; evidenceIds:string[]; taskType:string; }
interface Action { id:string; actionRef:string; title:string; targetDate:string; workflowTaskId:string|null; planData:ActionForm; assignee:{userId:string;fullNameEn:string;fullNameAr:string}; canExecute:boolean;completionPct:number;overdue:boolean;closureDate:string|null;progress:Array<{id:string;completionPct:number;justification:string}>; }
interface Context {
 version:number;canEdit:boolean;canSubmit:boolean;canReview:boolean;canApprove:boolean;referencesCurrent:boolean;taskId:string|null;
 references:{ready:boolean;lists:Array<{listCode:string;values:Array<{code:string;labelEn:string;labelAr:string}>}>};
 actions:Action[];completionPct:number|null;executors:Array<{userId:string;fullNameEn:string;fullNameAr:string}>;
 history:Array<{id:string;round:number;decision:{decision:string;justification:string}|null}>;
}
const empty=():ActionForm=>({title:'',description:'',actionType:'',priorityCode:'',assigneeUserId:'',startDate:'',targetDate:'',evidenceRequired:'',evidenceIds:[],taskType:'information'});
@Component({selector:'app-ai-treatment',standalone:true,imports:[FormsModule,AppIcon,StatusChip,AiControlPicker],templateUrl:'./ai-treatment.html',styleUrls:['../ai-review/ai-review.scss','./ai-risk-assessment.scss'],changeDetection:ChangeDetectionStrategy.OnPush})
export class AiTreatment {
 readonly riskId=input.required<string>();readonly updated=output<void>();
 private readonly http=inject(HttpClient);protected readonly i18n=inject(I18nService);private readonly toast=inject(ToastService);
 protected readonly context=signal<Context|null>(null);protected readonly working=signal(false);protected readonly state=signal<'loading'|'ok'|'error'>('loading');
 protected readonly controls=signal<ControlTag[]>([]);protected readonly selectedControls=signal<string[]>([]);
 protected readonly form=signal<ActionForm>(empty());protected readonly editingId=signal<string|null>(null);protected readonly evidence=signal('');
 protected readonly reason=signal('');protected readonly reviewEvidence=signal('');private sequence=0;
 protected readonly execution=signal<Record<string,{completionPct:number;justification:string;evidence:string}>>({});
 constructor(){effect(()=>{void this.load(this.riskId());});}
 protected t(key:string):string{return this.i18n.t(key);}
 protected label(value:{labelEn:string;labelAr:string}):string{return this.i18n.lang()==='ar'?value.labelAr:value.labelEn;}
 protected name(value:{fullNameEn:string;fullNameAr:string}):string{return this.i18n.lang()==='ar'?value.fullNameAr:value.fullNameEn;}
 protected choices(code:string){return this.context()?.references.lists.find(list=>list.listCode===code)?.values??[];}
 protected patch(field:keyof ActionForm,value:string):void{this.form.update(form=>({...form,[field]:value}));}
 protected reset():void{this.form.set(empty());this.editingId.set(null);this.evidence.set('');this.selectedControls.set([]);}
 protected edit(action:Action):void{this.form.set({...action.planData,title:action.title,targetDate:action.targetDate.slice(0,10),startDate:action.planData.startDate??'',assigneeUserId:action.assignee.userId});this.selectedControls.set(action.planData.controlDomains?.map(p=>p.versionId)??[]);this.editingId.set(action.id);this.evidence.set(action.planData.evidenceIds.join(', '));}
 protected async load(id=this.riskId()):Promise<void>{
  if(id!==this.riskId())return;const sequence=++this.sequence;this.state.set('loading');this.context.set(null);this.reset();this.reason.set('');this.reviewEvidence.set('');
  try{const context=await firstValueFrom(this.http.get<Context>(`/api/ai/risks/${id}/treatment`));if(sequence!==this.sequence)return;this.controls.set((await firstValueFrom(this.http.get<{rows:ControlTag[]}>('/api/ai/control-domains'))).rows);if(sequence!==this.sequence)return;this.execution.set(Object.fromEntries(context.actions.map(action=>[action.id,{completionPct:action.completionPct,justification:'',evidence:''}])));this.context.set(context);this.state.set('ok');}
  catch(error){if(sequence===this.sequence){this.state.set('error');this.toast.errorFrom(error,this.t('aiTreatment.error'));}}
 }
 private identifiers(value:string):string[]{return [...new Set(value.split(/[\s,;]+/u).filter(Boolean))];}
 protected valid():boolean{const f=this.form();return !!f.title.trim()&&!!f.description.trim()&&!!f.actionType&&!!f.priorityCode&&!!f.assigneeUserId&&!!f.targetDate&&(!['PREVENTIVE','CORRECTIVE'].includes(f.actionType)||!!f.evidenceRequired.trim());}
 protected async save():Promise<void>{
  if(!this.context()?.canEdit||!this.valid())return;const f=this.form();
  await this.mutate(this.editingId()?`actions/${this.editingId()}`:'actions',{expectedVersion:this.context()!.version,title:f.title,description:f.description,actionType:f.actionType,priorityCode:f.priorityCode,assigneeUserId:f.assigneeUserId,
   targetDate:f.targetDate,...(f.startDate?{startDate:f.startDate}:{}),evidenceRequired:f.evidenceRequired,evidenceIds:this.identifiers(this.evidence()),taskType:f.taskType,controlVersionIds:this.selectedControls()},!!this.editingId());
 }
 protected async submit():Promise<void>{if(this.context()?.canSubmit)await this.mutate('treatment/submit',{expectedVersion:this.context()!.version});}
 protected patchExecution(id:string,field:'completionPct'|'justification'|'evidence',value:string|number):void{this.execution.update(values=>({...values,[id]:{...values[id],[field]:value}}));}
 protected async progress(action:Action):Promise<void>{const c=this.context(),draft=this.execution()[action.id];if(!c||!action.canExecute||!draft.justification.trim()||!Number.isInteger(draft.completionPct)||draft.completionPct<0||draft.completionPct>100)return;await this.mutate(`actions/${action.id}/progress`,{expectedVersion:c.version,completionPct:draft.completionPct,justification:draft.justification.trim(),evidenceIds:this.identifiers(draft.evidence)});}
 protected async review(decision:'approve'|'return'):Promise<void>{const c=this.context();if(!c?.canReview||(decision==='approve'&&!c.canApprove)||!this.reason().trim()||!this.reviewEvidence().trim())return;await this.mutate(`treatment/tasks/${c.taskId}`,{expectedVersion:c.version,decision,justification:this.reason().trim(),evidenceIds:this.identifiers(this.reviewEvidence())});}
 private async mutate(path:string,body:unknown,patch=false):Promise<void>{if(this.working())return;this.working.set(true);const id=this.riskId();try{await firstValueFrom(patch?this.http.patch(`/api/ai/risks/${id}/${path}`,body):this.http.post(`/api/ai/risks/${id}/${path}`,body));this.toast.success(this.t('aiTreatment.saved'));this.updated.emit();}catch(error){this.toast.errorFrom(error,this.t('aiTreatment.error'));await this.load(id);}finally{this.working.set(false);}}
}
