import { AiJourneyHistory } from '../../../shared/ai-journey-history';
import { ChangeDetectionStrategy, Component, inject, OnInit, signal } from '@angular/core';
import { DatePipe } from '@angular/common';
import { HttpClient } from '@angular/common/http';
import { FormsModule } from '@angular/forms';
import { firstValueFrom } from 'rxjs';
import { TableModule } from 'primeng/table';
import { I18nService } from '../../../core/i18n.service';
import { ToastService } from '../../../shared/toast.service';
import { AppIcon } from '../../../shared/app-icon';
import { StatusChip } from '../../../shared/status-chip';

interface Measures {total:number;completed:number;overdue:number;due:number;closedOnTime:number;onTimePercent:number|null;dueSoon:number;superseded:number}
interface Report {asOf:string;mode:string;aggregateOnly:boolean;periodic:Measures;calendar:Array<{id:string;dueAt:string;bandCode:string;status:string;risk:{riskRef:string;title:string}}>;
  calendarTotal:number;page:number;pageSize:number}
interface Unit {id:string;nameEn:string;nameAr:string}
interface AnnualReview {id:string;round:number;dueAt:string;status:string;canComplete:boolean;canHandover:boolean;handoverRound:number;currentOfficerId:string;handovers:Array<{id:string;round:number;justification:string;evidenceIds:string[];createdAt:string}>;sourceSnapshot:{asOf:string;members:Array<{id:string;riskRef:string;assessments:Array<{kind:string;result:Record<string,unknown>}>}>;periodic:Measures};
  completion:{trendsSummary:string;controlEffectivenessSummary:string;nonconformitySummary:string;evidenceIds:string[];completedAt:string}|null}
interface AnnualContext {canRegister:boolean;canCaptureMonthly:boolean;nominees:Array<{id:string;email:string}>;history:AnnualReview[]}
interface Cadence {ready:boolean;engineReady:boolean;engineVersionId:string|null;cadenceVersionId:string|null;mappings:Array<{bandCode:string;intervalDays:number|null;cadenceCode:string|null;labelEn:string|null;labelAr:string|null;firstReviewImmediate:boolean}>;issues:string[]}
interface ReviewDetail {id:string;round:number;dueAt:string;anchorAt:string;bandCode:string;intervalDays:number;referenceVersionId:string;cadenceReferenceVersionId:string|null;displayCadenceLabelEn:string|null;displayCadenceLabelAr:string|null;status:string;risk:{riskRef:string;title:string};completion:{justification:string;evidenceIds:string[];completedAt:string}|null;cancellation:{reassessment:{triggerCode:string;justification:string};createdAt:string}|null;signals:Array<{threshold:number;createdAt:string}>}
interface MonthlyRow {id:string;periodMonth:string;capturedAt:string;sourceCount:number}
interface MonthlySnapshot extends MonthlyRow {periodStart:string;periodEnd:string;measures:Measures}

@Component({selector:'app-ai-reviews',standalone:true,imports: [AiJourneyHistory, DatePipe,FormsModule,TableModule,AppIcon,StatusChip],
  templateUrl:'./ai-reviews.html',styleUrls:['../ai-review/ai-review.scss','./ai-reviews.scss'],changeDetection:ChangeDetectionStrategy.OnPush})
export class AiReviewsPage implements OnInit {
  private readonly http=inject(HttpClient);protected readonly i18n=inject(I18nService);private readonly toast=inject(ToastService);
  protected readonly report=signal<Report|null>(null);protected readonly units=signal<Unit[]>([]);protected readonly annual=signal<AnnualContext|null>(null);
  protected readonly state=signal<'loading'|'ok'|'error'>('loading');protected readonly annualState=signal<'idle'|'loading'|'ok'|'error'>('idle');protected readonly working=signal(false);
  protected readonly tab=signal<'report'|'annual'|'cadence'|'monthly'>('report');
  protected readonly cadence=signal<Cadence|null>(null);protected readonly detail=signal<ReviewDetail|null>(null);protected readonly detailLoading=signal(false);
  protected readonly monthlyRows=signal<MonthlyRow[]>([]);protected readonly monthlySnapshot=signal<MonthlySnapshot|null>(null);protected readonly monthlyLoading=signal(false);protected readonly cadenceState=signal<'idle'|'loading'|'ok'|'error'>('idle');
  protected filter='all';protected readonly filters=['next30','all','overdue','due_soon','scheduled','completed','superseded'];protected nomineeId='';protected handoverJustification='';protected handoverEvidence='';
  protected periodMonth=(()=>{const d=new Date(Date.now()+10800000);return new Date(Date.UTC(d.getUTCFullYear(),d.getUTCMonth()-1,1)).toISOString().slice(0,7);})();
  private detailSequence=0;private monthlySequence=0;protected unitId='';protected trends='';protected controls='';protected nonconformities='';protected evidence='';
  private sequence=0;private annualSequence=0;
  ngOnInit(){void this.load();}
  protected t(key:string){return this.i18n.t(key);}
  protected label(unit:Unit){return this.i18n.lang()==='ar'?unit.nameAr:unit.nameEn;}
  protected async load(page=1){
    const sequence=++this.sequence;this.state.set('loading');this.detail.set(null);++this.detailSequence;this.detailLoading.set(false);
    try{const report=await firstValueFrom(this.http.get<Report>(`/api/ai/review-operations/report?page=${page}&pageSize=20&filter=${encodeURIComponent(this.filter)}`));if(sequence!==this.sequence)return;
      this.report.set(report);this.state.set('ok');
      if(['governance','audit'].includes(report.mode)&&!this.units().length){
        try{const result=await firstValueFrom(this.http.get<{units:Unit[]}>('/api/ai/review-operations/units'));if(sequence===this.sequence)this.units.set(result.units);}
        catch(e){if(sequence===this.sequence)this.toast.errorFrom(e,this.t('aiReviews.error'));}
      }
    }catch(e){if(sequence===this.sequence){this.state.set('error');this.toast.errorFrom(e,this.t('aiReviews.error'));}}
  }
  protected async selectUnit(){
    const sequence=++this.annualSequence,id=this.unitId;this.annual.set(null);this.trends='';this.controls='';this.nonconformities='';this.evidence='';this.nomineeId='';this.handoverJustification='';this.handoverEvidence='';this.monthlySnapshot.set(null);this.monthlyRows.set([]);++this.monthlySequence;this.monthlyLoading.set(false);
    if(!id){this.annualState.set('idle');return;}this.annualState.set('loading');
    try{const c=await firstValueFrom(this.http.get<AnnualContext>(`/api/ai/review-operations/annual/${id}`));if(sequence!==this.annualSequence)return;this.annual.set(c);this.annualState.set('ok');if(this.tab()==='monthly')await this.loadMonthly();}
    catch(e){if(sequence===this.annualSequence){this.annualState.set('error');this.toast.errorFrom(e,this.t('aiReviews.error'));}}
  }
  protected score(member:AnnualReview['sourceSnapshot']['members'][number],kind:string){const r=member.assessments.find(a=>a.kind===kind)?.result;return r?`${r['score']??'—'} · ${r['bandCode']??'—'}`:'—';}
  protected async register(){if(this.working()||!this.annual()?.canRegister)return;this.working.set(true);
    try{await firstValueFrom(this.http.post('/api/ai/review-operations/annual',{organizationUnitId:this.unitId}));this.toast.success(this.t('aiAdoption.saved'));await this.selectUnit();}
    catch(e){this.toast.errorFrom(e,this.t('aiReviews.error'));await this.selectUnit();}finally{this.working.set(false);}
  }
  protected async complete(row:AnnualReview){if(this.working()||!row.canComplete||!this.trends.trim()||!this.controls.trim()||!this.nonconformities.trim()||!this.evidence.trim())return;
    const evidenceIds=[...new Set(this.evidence.split(/[\s,;]+/u).filter(Boolean))];this.working.set(true);
    try{await firstValueFrom(this.http.post(`/api/ai/review-operations/annual/${row.id}/complete`,{expectedRound:row.round,expectedHandoverRound:row.handoverRound,trendsSummary:this.trends.trim(),controlEffectivenessSummary:this.controls.trim(),nonconformitySummary:this.nonconformities.trim(),evidenceIds}));this.toast.success(this.t('aiAdoption.saved'));await this.selectUnit();await this.load(this.report()?.page??1);}
    catch(e){this.toast.errorFrom(e,this.t('aiReviews.error'));await this.selectUnit();}finally{this.working.set(false);}
  }
  protected async showCadence(){this.tab.set('cadence');this.cadenceState.set('loading');try{this.cadence.set(await firstValueFrom(this.http.get<Cadence>('/api/ai/review-operations/cadence-config')));this.cadenceState.set('ok');}catch(e){this.cadenceState.set('error');this.toast.errorFrom(e,this.t('aiReviews.error'));}}
  protected async openDetail(id:string){const seq=++this.detailSequence;this.detail.set(null);this.detailLoading.set(true);try{const d=await firstValueFrom(this.http.get<ReviewDetail>('/api/ai/review-operations/reviews/'+id));if(seq===this.detailSequence)this.detail.set(d);}catch(e){if(seq===this.detailSequence)this.toast.errorFrom(e,this.t('aiReviews.error'));}finally{if(seq===this.detailSequence)this.detailLoading.set(false);}}
  protected closeDetail(){++this.detailSequence;this.detail.set(null);this.detailLoading.set(false);}
  protected async handover(row:AnnualReview){if(this.working()||!row.canHandover||!this.nomineeId||!this.handoverJustification.trim()||!this.handoverEvidence.trim())return;this.working.set(true);try{await firstValueFrom(this.http.post('/api/ai/review-operations/annual/'+row.id+'/handover',{expectedHandoverRound:row.handoverRound,toOfficerId:this.nomineeId,justification:this.handoverJustification.trim(),evidenceIds:[...new Set(this.handoverEvidence.split(/[\s,;]+/u).filter(Boolean))]}));this.toast.success(this.t('aiAdoption.saved'));await this.selectUnit();}catch(e){this.toast.errorFrom(e,this.t('aiReviews.error'));await this.selectUnit();}finally{this.working.set(false);}}
  protected async showMonthly(){this.tab.set('monthly');if(this.unitId)await this.selectUnit();}
  protected async loadMonthly(){const seq=++this.monthlySequence,id=this.unitId;this.monthlyLoading.set(true);this.monthlySnapshot.set(null);try{const rows=await firstValueFrom(this.http.get<MonthlyRow[]>('/api/ai/review-operations/monthly/'+id));if(seq===this.monthlySequence&&id===this.unitId)this.monthlyRows.set(rows);}catch(e){if(seq===this.monthlySequence)this.toast.errorFrom(e,this.t('aiReviews.error'));}finally{if(seq===this.monthlySequence)this.monthlyLoading.set(false);}}
  protected async openMonthly(id:string){const seq=++this.monthlySequence;this.monthlyLoading.set(true);this.monthlySnapshot.set(null);try{const s=await firstValueFrom(this.http.get<MonthlySnapshot>('/api/ai/review-operations/monthly-snapshots/'+id));if(seq===this.monthlySequence)this.monthlySnapshot.set(s);}catch(e){if(seq===this.monthlySequence)this.toast.errorFrom(e,this.t('aiReviews.error'));}finally{if(seq===this.monthlySequence)this.monthlyLoading.set(false);}}
  protected async captureMonthly(){if(this.working()||!this.annual()?.canCaptureMonthly||!this.periodMonth)return;this.working.set(true);try{const r=await firstValueFrom(this.http.post<{id:string}>('/api/ai/review-operations/monthly',{organizationUnitId:this.unitId,periodMonth:this.periodMonth}));this.toast.success(this.t('aiAdoption.saved'));await this.loadMonthly();await this.openMonthly(r.id);}catch(e){this.toast.errorFrom(e,this.t('aiReviews.error'));await this.loadMonthly();}finally{this.working.set(false);}}

}
