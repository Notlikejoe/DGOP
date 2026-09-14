import { ChangeDetectionStrategy, Component, computed, inject, Input, OnInit, signal } from '@angular/core';
import { DatePipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { HttpClient } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';
import { TableModule } from 'primeng/table';
import { I18nService } from '../../../core/i18n.service';
import { ToastService } from '../../../shared/toast.service';
import { AppIcon } from '../../../shared/app-icon';
interface ReportRow {id:string;frequency:string;periodKey:string;asOf:string}
interface ReportKpi {id:string;labelEn:string;labelAr:string;value:number|null;unit:string;numerator?:number;denominator?:number}
interface Report extends ReportRow {digest:string;projection:{cards:ReportKpi[];reconciliation:{balanced:boolean;total:number;sum:number}|null}}
interface Schedule {canManage:boolean;workerEnabled:boolean;latest:{round:number;dailyEnabled:boolean;monthlyEnabled:boolean}|null;history:Array<{id:string;round:number;dailyEnabled:boolean;monthlyEnabled:boolean;createdAt:string;justification:string}>;runs:Array<{id:string;frequency:string;periodKey:string;attempt:number;status:string;errorCode:string|null;snapshotId:string|null;createdAt:string}>}
interface Comparison {leftAsOf:string;rightAsOf:string;rows:Array<{id:string;labelEn:string;labelAr:string;left:number|null;right:number|null;delta:number|null;deltaUnit:string}>}
interface Trend {rows:Array<{snapshotId:string;asOf:string;value:number|null;unit:string;numerator:number|null;denominator:number|null;previousAsOf:string|null;delta:number|null;deltaUnit:string;cohortChanged:boolean|null}>;total:number;page:number;pageSize:number;kpi:{id:string;labelEn:string;labelAr:string;unit:string};availableKpis:Array<{id:string;labelEn:string;labelAr:string;unit:string}>}
@Component({selector:'app-ai-dashboard-reports',standalone:true,imports:[DatePipe,FormsModule,TableModule,AppIcon],templateUrl:'./ai-dashboard-reports.html',styleUrls:['../ai-review/ai-review.scss','../ai-reviews/ai-reviews.scss','./ai-dashboard.scss'],changeDetection:ChangeDetectionStrategy.OnPush})
export class AiDashboardReports implements OnInit {
 @Input() aggregateOnly=false;
 private readonly http=inject(HttpClient);protected readonly i18n=inject(I18nService);private readonly toast=inject(ToastService);
 protected readonly units=signal<Array<{id:string;nameEn:string;nameAr:string}>>([]);protected readonly unitId=signal('');
 protected readonly state=signal<'loading'|'ok'|'error'>('loading');protected readonly working=signal(false);
 protected readonly list=signal<{rows:ReportRow[];total:number;page:number;pageSize:number}>({rows:[],total:0,page:1,pageSize:20});
 protected readonly report=signal<Report|null>(null);protected readonly detailState=signal<'idle'|'loading'|'ok'|'error'>('idle');
 protected readonly schedule=signal<Schedule|null>(null);protected readonly comparison=signal<Comparison|null>(null);
 protected readonly compareId=signal('');protected readonly frequency=signal('manual');protected readonly daily=signal(false);protected readonly monthly=signal(false);protected readonly justification=signal('');protected readonly evidence=signal('');
 protected readonly comparisonChoices=computed(()=>this.list().rows.filter(r=>r.id!==this.report()?.id&&r.frequency===this.report()?.frequency));
 protected readonly trend=signal<Trend|null>(null);protected readonly trendState=signal<'idle'|'loading'|'ok'|'error'>('idle');protected readonly trendKpi=signal('GEN-85');protected readonly trendFrequency=signal('manual');
 private sequence=0;private detailSequence=0;private trendSequence=0;
 protected t(k:string){return this.i18n.t(k);}
 protected label(k:{labelEn:string;labelAr:string}){return this.i18n.lang()==='ar'?k.labelAr:k.labelEn;}
 protected unitLabel(k:{nameEn:string;nameAr:string}){return this.i18n.lang()==='ar'?k.nameAr:k.nameEn;}
 ngOnInit(){void this.load();}
 protected async load(){this.state.set('loading');try{const u=await firstValueFrom(this.http.get<{units:Array<{id:string;nameEn:string;nameAr:string}>}>('/api/ai/dashboard-reports/units'));this.units.set(u.units);this.unitId.set(u.units.find(u=>u.id===this.unitId())?.id??u.units[0]?.id??'');await this.loadUnit();}catch(e){this.state.set('error');this.toast.errorFrom(e,this.t('aiReports.error'));}}
 protected async loadUnit(page=1){const seq=++this.sequence;++this.detailSequence;++this.trendSequence;this.trend.set(null);this.trendState.set('idle');this.report.set(null);this.comparison.set(null);this.detailState.set('idle');this.state.set('loading');
  if(!this.unitId()){this.state.set('ok');return;}
  try{const [list,schedule]=await Promise.all([firstValueFrom(this.http.get<{rows:ReportRow[];total:number;page:number;pageSize:number}>(`/api/ai/dashboard-reports/units/${this.unitId()}/snapshots?page=${page}`)),this.aggregateOnly?Promise.resolve(null):firstValueFrom(this.http.get<Schedule>(`/api/ai/dashboard-reports/units/${this.unitId()}/schedule`))]);if(seq!==this.sequence)return;this.list.set(list);this.schedule.set(schedule);this.daily.set(schedule?.latest?.dailyEnabled??false);this.monthly.set(schedule?.latest?.monthlyEnabled??false);this.state.set('ok');void this.loadTrend();}catch(e){if(seq===this.sequence){this.state.set('error');this.toast.errorFrom(e,this.t('aiReports.error'));}}}
 protected async loadTrend(page=1){if(!this.unitId())return;const seq=++this.trendSequence;this.trendState.set('loading');try{const result=await firstValueFrom(this.http.get<Trend>(`/api/ai/dashboard-reports/units/${this.unitId()}/trend`,{params:{kpiId:this.trendKpi(),frequency:this.trendFrequency(),page}}));if(seq===this.trendSequence){this.trend.set(result);this.trendState.set('ok');}}catch(e){if(seq===this.trendSequence){this.trendState.set('error');this.toast.errorFrom(e,this.t('aiReports.error'));}}}
 protected async open(id:string){const seq=++this.detailSequence;this.report.set(null);this.comparison.set(null);this.compareId.set('');this.detailState.set('loading');try{const r=await firstValueFrom(this.http.get<Report>(`/api/ai/dashboard-reports/snapshots/${id}`));if(seq===this.detailSequence){this.report.set(r);this.detailState.set('ok');}}catch(e){if(seq===this.detailSequence){this.detailState.set('error');this.toast.errorFrom(e,this.t('aiReports.error'));}}}
 protected async capture(){if(!this.schedule()?.canManage||this.working())return;this.working.set(true);try{const r=await firstValueFrom(this.http.post<{id:string;created:boolean}>('/api/ai/dashboard-reports/snapshots',{organizationUnitId:this.unitId(),frequency:this.frequency()}));this.toast.success(this.t(r.created?'aiReports.captured':'aiReports.existing'));await this.loadUnit();await this.open(r.id);}catch(e){this.toast.errorFrom(e,this.t('aiReports.error'));}finally{this.working.set(false);}}
 protected async configure(){if(!this.schedule()?.canManage||this.working()||!this.justification().trim())return;this.working.set(true);try{await firstValueFrom(this.http.post(`/api/ai/dashboard-reports/units/${this.unitId()}/schedule`,{expectedRound:this.schedule()?.latest?.round??0,dailyEnabled:this.daily(),monthlyEnabled:this.monthly(),justification:this.justification(),evidenceIds:[...new Set(this.evidence().split(/[\s,;]+/u).filter(Boolean))]}));this.justification.set('');this.evidence.set('');this.toast.success(this.t('aiReports.configured'));await this.loadUnit();}catch(e){this.toast.errorFrom(e,this.t('aiReports.error'));}finally{this.working.set(false);}}
 protected async compare(){const r=this.report();if(!r||!this.compareId()||this.working())return;const seq=this.detailSequence;this.working.set(true);try{const c=await firstValueFrom(this.http.get<Comparison>(`/api/ai/dashboard-reports/compare?leftId=${r.id}&rightId=${this.compareId()}`));if(seq===this.detailSequence)this.comparison.set(c);}catch(e){this.toast.errorFrom(e,this.t('aiReports.error'));}finally{this.working.set(false);}}
 protected async download(){const r=this.report();if(!r||this.working())return;this.working.set(true);try{const blob=await firstValueFrom(this.http.get(`/api/ai/dashboard-reports/snapshots/${r.id}/export`,{responseType:'blob'})),url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=`DGOP-AI-${r.id}.csv`;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}catch(e){this.toast.errorFrom(e,this.t('aiReports.error'));}finally{this.working.set(false);}}
}
