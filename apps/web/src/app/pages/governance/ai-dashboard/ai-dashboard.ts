import { DualDatePipe } from '../../../shared/dual-date.pipe';
import { AiJourneyHistory } from '../../../shared/ai-journey-history';
import { AiDashboardReports } from './ai-dashboard-reports';
import { ChangeDetectionStrategy, Component, computed, inject, OnInit, signal } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { RouterLink } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { firstValueFrom } from 'rxjs';
import { TableModule } from 'primeng/table';
import { AppIcon } from '../../../shared/app-icon';
import { I18nService } from '../../../core/i18n.service';
import { ToastService } from '../../../shared/toast.service';
interface Kpi {id:string;labelEn:string;labelAr:string;group:string;unit:string;frequency:string;formulaEn:string;formulaAr:string;coverage:string;filter:string|null;value:number|null;numerator?:number;denominator?:number}
interface Dashboard {governance:{assessmentDue:number;assessmentComplete:number;assessmentMissingDeadline:number;high:number;highReviewed:number;mandatory:number;mandatoryReviewed:number}|null;asOf:string;mode:string;aggregateOnly:boolean;cards:Kpi[];catalog:Kpi[];reconciliation:{total:number;high:number;unclassified:number;otherClassified:number;sum:number;balanced:boolean}|null;matrix:{cells:number[][];assessed:number;unassessed:number}|null;distribution:Array<{nameEn:string|null;nameAr:string|null;count:number}>;topRisks:Array<{id:string;riskRef:string;title:string;inherentScore:number|null;residualScore:number|null;residualBand:string;completionPct:number}>}
interface CapturedBasis {savedAsOf:string|null;periodKey?:string;rows:Array<{id:string;unit:string;saved:number|null;changed:boolean|null}>}
interface Drilldown {filter:string;page:number;pageSize:number;total:number;readOnly:boolean;asOf:string;rows:Array<{id:string;reference:string;title:string;approvedTier?:string;inherentScore?:number;residualScore?:number;completionPct?:number;dueAt?:string;riskRef?:string;kind?:string;round?:number;validDimensions?:number}>}
@Component({selector:'app-ai-dashboard',standalone:true,imports: [AiJourneyHistory, AiDashboardReports,DualDatePipe,FormsModule,RouterLink,TableModule,AppIcon],templateUrl:'./ai-dashboard.html',styleUrls:['../ai-review/ai-review.scss','../ai-reviews/ai-reviews.scss','./ai-dashboard.scss'],changeDetection:ChangeDetectionStrategy.OnPush})
export class AiDashboardPage implements OnInit {
 private readonly http=inject(HttpClient);protected readonly i18n=inject(I18nService);private readonly toast=inject(ToastService);
 protected readonly viewBasis=signal<'live'|'scheduled'>('live');protected readonly basisState=signal<'idle'|'loading'|'ok'|'error'>('idle');
 protected readonly units=signal<Array<{id:string;nameEn:string;nameAr:string}>>([]);protected readonly unitId=signal('');
 protected readonly scheduled=signal<{daily:CapturedBasis;monthly:CapturedBasis}|null>(null);private basisSequence=0;
 protected readonly dashboard=signal<Dashboard|null>(null);protected readonly state=signal<'loading'|'ok'|'error'>('loading');protected readonly group=signal('register');
 protected readonly drilldown=signal<Drilldown|null>(null);protected readonly detailsState=signal<'idle'|'loading'|'ok'|'error'>('idle');
 protected readonly groups=['register','posture','treatment','pipeline','governance','reports','definitions'];protected readonly levels=[1,2,3,4];
 protected readonly cards=computed(()=>this.dashboard()?.cards.filter(k=>k.group===this.group()||(this.group()==='treatment'&&k.group==='reviews'))??[]);
 private sequence=0;private detailSequence=0;private currentFilter='';
 ngOnInit(){void this.load();}
 protected t(k:string){return this.i18n.t(k);}
 protected label(k:{labelEn:string;labelAr:string}){return this.i18n.lang()==='ar'?k.labelAr:k.labelEn;}
 protected formula(k:Kpi){return this.i18n.lang()==='ar'?k.formulaAr:k.formulaEn;}
 protected value(k:Kpi){const value=this.viewBasis()==='live'?k.value:this.observation(k)?.row.saved??null;return value===null?'—':value+(k.unit==='percent'?'%':'');}
 protected observation(k:Kpi){const basis=this.scheduled()?.[k.frequency==='Monthly'?'monthly':'daily'],row=basis?.rows.find(r=>r.id===k.id&&r.unit===k.unit&&r.changed!==null);return basis?.savedAsOf&&row?{asOf:basis.savedAsOf,periodKey:basis.periodKey,row}:null;}
 protected unitLabel(u:{nameEn:string;nameAr:string}){return this.i18n.lang()==='ar'?u.nameAr:u.nameEn;}
 protected async chooseBasis(value:'live'|'scheduled'){if(this.dashboard()?.mode==='risk_owner'&&value!=='live')return;this.viewBasis.set(value);this.closeDetails();++this.basisSequence;this.scheduled.set(null);this.basisState.set('idle');if(value==='scheduled')await this.loadScheduled();}
 protected async loadScheduled(){const sequence=++this.basisSequence;this.scheduled.set(null);this.basisState.set('loading');try{
  const result=await firstValueFrom(this.http.get<{units:Array<{id:string;nameEn:string;nameAr:string}>}>('/api/ai/dashboard-reports/units'));if(sequence!==this.basisSequence||this.viewBasis()!=='scheduled')return;
  this.units.set(result.units);this.unitId.set(result.units.find(u=>u.id===this.unitId())?.id??result.units[0]?.id??'');if(!this.unitId()){this.basisState.set('ok');return;}
  const id=this.unitId(),[daily,monthly]=await Promise.all(['daily','monthly'].map(frequency=>firstValueFrom(this.http.get<CapturedBasis>(`/api/ai/dashboard-reports/units/${id}/basis`,{params:{frequency}}))));
  if(sequence===this.basisSequence&&this.viewBasis()==='scheduled'&&id===this.unitId()){this.scheduled.set({daily,monthly});this.basisState.set('ok');}
 }catch(e){if(sequence===this.basisSequence&&this.viewBasis()==='scheduled'){this.basisState.set('error');this.toast.errorFrom(e,this.t('aiReports.error'));}}}
 protected choose(group:string){this.group.set(group);this.closeDetails();}
 protected closeDetails(){++this.detailSequence;this.drilldown.set(null);this.detailsState.set('idle');}
 protected async load(){const seq=++this.sequence;this.state.set('loading');this.closeDetails();try{const d=await firstValueFrom(this.http.get<Dashboard>('/api/ai/dashboard'));if(seq!==this.sequence)return;this.dashboard.set(d);if(d.mode==='risk_owner'&&this.group()==='register')this.group.set('treatment');this.state.set('ok');if(d.mode==='risk_owner'){this.viewBasis.set('live');++this.basisSequence;this.scheduled.set(null);}else if(this.viewBasis()==='scheduled')void this.loadScheduled();}catch(e){if(seq===this.sequence){this.state.set('error');this.toast.errorFrom(e,this.t('aiDashboard.error'));}}}
 protected async openDetails(filter:string,page=1){const seq=++this.detailSequence;this.currentFilter=filter;this.drilldown.set(null);this.detailsState.set('loading');try{const d=await firstValueFrom(this.http.get<Drilldown>('/api/ai/dashboard/drilldown?filter='+encodeURIComponent(filter)+'&page='+page+'&pageSize=20'));if(seq===this.detailSequence){this.drilldown.set(d);this.detailsState.set('ok');}}catch(e){if(seq===this.detailSequence){this.detailsState.set('error');this.toast.errorFrom(e,this.t('aiDashboard.error'));}}}
 protected retryDetails(){void this.openDetails(this.currentFilter);}
}
