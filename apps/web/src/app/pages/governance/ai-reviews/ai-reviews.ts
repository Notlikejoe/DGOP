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
interface AnnualReview {id:string;round:number;dueAt:string;status:string;canComplete:boolean;sourceSnapshot:{asOf:string;members:Array<{id:string;riskRef:string;assessments:Array<{kind:string;result:Record<string,unknown>}>}>;periodic:Measures};
  completion:{trendsSummary:string;controlEffectivenessSummary:string;nonconformitySummary:string;evidenceIds:string[];completedAt:string}|null}
interface AnnualContext {canRegister:boolean;history:AnnualReview[]}

@Component({selector:'app-ai-reviews',standalone:true,imports:[DatePipe,FormsModule,TableModule,AppIcon,StatusChip],
  templateUrl:'./ai-reviews.html',styleUrls:['../ai-review/ai-review.scss','./ai-reviews.scss'],changeDetection:ChangeDetectionStrategy.OnPush})
export class AiReviewsPage implements OnInit {
  private readonly http=inject(HttpClient);protected readonly i18n=inject(I18nService);private readonly toast=inject(ToastService);
  protected readonly report=signal<Report|null>(null);protected readonly units=signal<Unit[]>([]);protected readonly annual=signal<AnnualContext|null>(null);
  protected readonly state=signal<'loading'|'ok'|'error'>('loading');protected readonly annualState=signal<'idle'|'loading'|'ok'|'error'>('idle');protected readonly working=signal(false);
  protected readonly tab=signal<'report'|'annual'>('report');protected unitId='';protected trends='';protected controls='';protected nonconformities='';protected evidence='';
  private sequence=0;private annualSequence=0;
  ngOnInit(){void this.load();}
  protected t(key:string){return this.i18n.t(key);}
  protected label(unit:Unit){return this.i18n.lang()==='ar'?unit.nameAr:unit.nameEn;}
  protected async load(page=1){
    const sequence=++this.sequence;this.state.set('loading');
    try{const report=await firstValueFrom(this.http.get<Report>(`/api/ai/review-operations/report?page=${page}&pageSize=20`));if(sequence!==this.sequence)return;
      this.report.set(report);this.state.set('ok');
      if(['governance','audit'].includes(report.mode)&&!this.units().length){
        try{const result=await firstValueFrom(this.http.get<{units:Unit[]}>('/api/ai/review-operations/units'));if(sequence===this.sequence)this.units.set(result.units);}
        catch(e){if(sequence===this.sequence)this.toast.errorFrom(e,this.t('aiReviews.error'));}
      }
    }catch(e){if(sequence===this.sequence){this.state.set('error');this.toast.errorFrom(e,this.t('aiReviews.error'));}}
  }
  protected async selectUnit(){
    const sequence=++this.annualSequence,id=this.unitId;this.annual.set(null);this.trends='';this.controls='';this.nonconformities='';this.evidence='';
    if(!id){this.annualState.set('idle');return;}this.annualState.set('loading');
    try{const c=await firstValueFrom(this.http.get<AnnualContext>(`/api/ai/review-operations/annual/${id}`));if(sequence!==this.annualSequence)return;this.annual.set(c);this.annualState.set('ok');}
    catch(e){if(sequence===this.annualSequence){this.annualState.set('error');this.toast.errorFrom(e,this.t('aiReviews.error'));}}
  }
  protected score(member:AnnualReview['sourceSnapshot']['members'][number],kind:string){const r=member.assessments.find(a=>a.kind===kind)?.result;return r?`${r['score']??'—'} · ${r['bandCode']??'—'}`:'—';}
  protected async register(){if(this.working()||!this.annual()?.canRegister)return;this.working.set(true);
    try{await firstValueFrom(this.http.post('/api/ai/review-operations/annual',{organizationUnitId:this.unitId}));this.toast.success(this.t('aiAdoption.saved'));await this.selectUnit();}
    catch(e){this.toast.errorFrom(e,this.t('aiReviews.error'));await this.selectUnit();}finally{this.working.set(false);}
  }
  protected async complete(row:AnnualReview){if(this.working()||!row.canComplete||!this.trends.trim()||!this.controls.trim()||!this.nonconformities.trim()||!this.evidence.trim())return;
    const evidenceIds=[...new Set(this.evidence.split(/[\s,;]+/u).filter(Boolean))];this.working.set(true);
    try{await firstValueFrom(this.http.post(`/api/ai/review-operations/annual/${row.id}/complete`,{expectedRound:row.round,trendsSummary:this.trends.trim(),controlEffectivenessSummary:this.controls.trim(),nonconformitySummary:this.nonconformities.trim(),evidenceIds}));this.toast.success(this.t('aiAdoption.saved'));await this.selectUnit();await this.load(this.report()?.page??1);}
    catch(e){this.toast.errorFrom(e,this.t('aiReviews.error'));await this.selectUnit();}finally{this.working.set(false);}
  }
}
