import { ChangeDetectionStrategy, Component, computed, inject, OnInit, signal } from '@angular/core';
import { DatePipe } from '@angular/common';
import { HttpClient } from '@angular/common/http';
import { RouterLink } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { firstValueFrom } from 'rxjs';
import { TableModule } from 'primeng/table';
import { AppIcon } from '../../../shared/app-icon';
import { I18nService } from '../../../core/i18n.service';
import { ToastService } from '../../../shared/toast.service';
interface Kpi {id:string;labelEn:string;labelAr:string;group:string;unit:string;frequency:string;formulaEn:string;formulaAr:string;coverage:string;filter:string|null;value:number|null;numerator?:number;denominator?:number}
interface Dashboard {asOf:string;mode:string;aggregateOnly:boolean;cards:Kpi[];catalog:Kpi[];reconciliation:{total:number;high:number;unclassified:number;otherClassified:number;sum:number;balanced:boolean}|null;matrix:{cells:number[][];assessed:number;unassessed:number}|null;distribution:Array<{nameEn:string|null;nameAr:string|null;count:number}>;topRisks:Array<{id:string;riskRef:string;title:string;inherentScore:number|null;residualScore:number|null;residualBand:string;completionPct:number}>}
interface Drilldown {filter:string;page:number;pageSize:number;total:number;readOnly:boolean;asOf:string;rows:Array<{id:string;reference:string;title:string;approvedTier?:string;inherentScore?:number;residualScore?:number;completionPct?:number;dueAt?:string;riskRef?:string}>}
@Component({selector:'app-ai-dashboard',standalone:true,imports:[DatePipe,FormsModule,RouterLink,TableModule,AppIcon],templateUrl:'./ai-dashboard.html',styleUrls:['../ai-review/ai-review.scss','../ai-reviews/ai-reviews.scss','./ai-dashboard.scss'],changeDetection:ChangeDetectionStrategy.OnPush})
export class AiDashboardPage implements OnInit {
 private readonly http=inject(HttpClient);protected readonly i18n=inject(I18nService);private readonly toast=inject(ToastService);
 protected readonly dashboard=signal<Dashboard|null>(null);protected readonly state=signal<'loading'|'ok'|'error'>('loading');protected readonly group=signal('register');
 protected readonly drilldown=signal<Drilldown|null>(null);protected readonly detailsState=signal<'idle'|'loading'|'ok'|'error'>('idle');
 protected readonly groups=['register','posture','treatment','pipeline','definitions'];protected readonly levels=[1,2,3,4];
 protected readonly cards=computed(()=>this.dashboard()?.cards.filter(k=>k.group===this.group()||(this.group()==='treatment'&&k.group==='reviews'))??[]);
 private sequence=0;private detailSequence=0;private currentFilter='';
 ngOnInit(){void this.load();}
 protected t(k:string){return this.i18n.t(k);}
 protected label(k:{labelEn:string;labelAr:string}){return this.i18n.lang()==='ar'?k.labelAr:k.labelEn;}
 protected formula(k:Kpi){return this.i18n.lang()==='ar'?k.formulaAr:k.formulaEn;}
 protected value(k:Kpi){return k.value===null?'—':k.value+(k.unit==='percent'?'%':'');}
 protected choose(group:string){this.group.set(group);this.closeDetails();}
 protected closeDetails(){++this.detailSequence;this.drilldown.set(null);this.detailsState.set('idle');}
 protected async load(){const seq=++this.sequence;this.state.set('loading');this.closeDetails();try{const d=await firstValueFrom(this.http.get<Dashboard>('/api/ai/dashboard'));if(seq!==this.sequence)return;this.dashboard.set(d);if(d.mode==='risk_owner'&&this.group()==='register')this.group.set('treatment');this.state.set('ok');}catch(e){if(seq===this.sequence){this.state.set('error');this.toast.errorFrom(e,this.t('aiDashboard.error'));}}}
 protected async openDetails(filter:string,page=1){const seq=++this.detailSequence;this.currentFilter=filter;this.drilldown.set(null);this.detailsState.set('loading');try{const d=await firstValueFrom(this.http.get<Drilldown>('/api/ai/dashboard/drilldown?filter='+encodeURIComponent(filter)+'&page='+page+'&pageSize=20'));if(seq===this.detailSequence){this.drilldown.set(d);this.detailsState.set('ok');}}catch(e){if(seq===this.detailSequence){this.detailsState.set('error');this.toast.errorFrom(e,this.t('aiDashboard.error'));}}}
 protected retryDetails(){void this.openDetails(this.currentFilter);}
}
