import { DualDatePipe } from '../../../shared/dual-date.pipe';
import { AiSourceCorrections } from './ai-source-corrections';
import { ChangeDetectionStrategy, Component, computed, inject, OnInit, signal } from '@angular/core';
import { JsonPipe } from '@angular/common';
import { HttpClient } from '@angular/common/http';
import { FormsModule } from '@angular/forms';
import { firstValueFrom } from 'rxjs';
import { TableModule } from 'primeng/table';
import { TagModule } from 'primeng/tag';
import { AppIcon } from '../../../shared/app-icon';
import { ToastService } from '../../../shared/toast.service';
import { I18nService } from '../../../core/i18n.service';
interface PreviewRow {key:string;kind:string;source:string;sheet:string;row:number;sourceRef:string;parentRef:string|null;raw:Record<string,{value:unknown;formula?:string;dateIso?:string;numberFormat?:string}>;prepared:Record<string,unknown>;issues:string[];checks:Array<{field:string;source:unknown;computed:unknown;equal:boolean|null}>;sample:boolean;status:string}
interface Reconciliation {counts:Record<string,number>;sourceCount:number;quarantinedCount:number;preparedCount:number;sampleCount:number;computedDiffCount:number;globalIssues:string[];loadedCount:number;targetCompared:boolean;zeroDiff:boolean|null;idChainVerified:boolean}
interface Decision {id:string;outcome:string;actorId:string;justification:string;createdAt:string;rowKey?:string}
interface SavedPreview {id:string;digest:string;createdAt:string;createdBy:string;justification:string;report:{rows:PreviewRow[];sources:Array<{source:string;sha256:string}>;reconciliation:Reconciliation};dispositions:Decision[];review:Decision|null}
interface Context {canPropose:boolean;canReview:boolean;sources:Array<{source:string;file:string;sha256:string}>}
@Component({selector:'app-ai-migration',standalone:true,imports: [AiSourceCorrections,DualDatePipe,JsonPipe,FormsModule,TableModule,TagModule,AppIcon],templateUrl:'./ai-migration.html',styleUrls:['../ai-review/ai-review.scss','../ai-reviews/ai-reviews.scss','./ai-migration.scss'],changeDetection:ChangeDetectionStrategy.OnPush})
export class AiMigrationPage implements OnInit {
 private readonly http=inject(HttpClient);private readonly toast=inject(ToastService);protected readonly i18n=inject(I18nService);
 protected readonly state=signal<'loading'|'ok'|'error'>('loading');protected readonly detailsState=signal<'idle'|'loading'|'ok'|'error'>('idle');protected readonly working=signal(false);
 protected readonly context=signal<Context|null>(null);protected readonly archive=signal<{rows:Array<{id:string;digest:string;createdAt:string;review:Decision|null;reconciliation:Reconciliation}>;total:number;page:number;pageSize:number}|null>(null);
 protected readonly saved=signal<SavedPreview|null>(null);protected readonly selected=signal<PreviewRow|null>(null);protected readonly kind=signal('all');protected readonly status=signal('all');protected readonly search=signal('');
 protected readonly justification=signal('');protected readonly evidence=signal('');protected readonly outcome=signal('defer');
 protected readonly kinds=['reference','library','control','usecase','classification','risk','assessment','action','intake'];
 protected readonly filtered=computed(()=>{const needle=this.search().toLocaleLowerCase();return this.saved()?.report.rows.filter(r=>(this.kind()==='all'||r.kind===this.kind())&&(this.status()==='all'||r.status===this.status())&&(!needle||(r.sourceRef+' '+r.sheet+' '+JSON.stringify(r.raw)).toLocaleLowerCase().includes(needle)))??[];});
 protected readonly rawCells=computed(()=>Object.entries(this.selected()?.raw??{}).map(([address,cell])=>({address,...cell})));
 protected readonly outstanding=computed(()=>this.saved()?.report.rows.filter(r=>r.status==='quarantined'&&!this.saved()?.dispositions.some(d=>d.rowKey===r.key)).length??0);
 private sequence=0;private detailSequence=0;private requestKey='';private requestBody='';private currentId='';
 ngOnInit(){void this.load();}protected t(k:string){return this.i18n.t(k);}
 protected ids(){return [...new Set(this.evidence().split(/[\s,;]+/u).filter(Boolean))];}
 protected disposition(r:PreviewRow){return this.saved()?.dispositions.find(d=>d.rowKey===r.key);}
 protected choose(r:PreviewRow){this.selected.set(r);this.justification.set('');this.evidence.set('');}
 protected async load(page=1){const seq=++this.sequence;this.state.set('loading');try{const [context,archive]=await Promise.all([firstValueFrom(this.http.get<Context>('/api/ai/migration-previews/context')),firstValueFrom(this.http.get<NonNullable<ReturnType<typeof this.archive>>>('/api/ai/migration-previews?page='+page+'&pageSize=20'))]);if(seq===this.sequence){this.context.set(context);this.archive.set(archive);this.state.set('ok');}}catch(e){if(seq===this.sequence){this.state.set('error');this.toast.errorFrom(e,this.t('aiMigration.error'));}}}
 protected async open(id:string){const seq=++this.detailSequence;this.currentId=id;this.detailsState.set('loading');this.saved.set(null);this.selected.set(null);this.justification.set('');this.evidence.set('');try{const d=await firstValueFrom(this.http.get<SavedPreview>('/api/ai/migration-previews/'+id));if(seq===this.detailSequence){this.saved.set(d);this.detailsState.set('ok');}}catch(e){if(seq===this.detailSequence){this.detailsState.set('error');this.toast.errorFrom(e,this.t('aiMigration.error'));}}}
 protected retryDetails(){void this.open(this.currentId);}
 protected close(){++this.detailSequence;this.saved.set(null);this.selected.set(null);this.detailsState.set('idle');this.justification.set('');this.evidence.set('');}
 protected async create(){if(this.working()||!this.context()?.canPropose)return;const body={justification:this.justification(),evidenceIds:this.ids()},serialized=JSON.stringify(body);if(serialized!==this.requestBody||!this.requestKey){this.requestBody=serialized;this.requestKey=crypto.randomUUID();}this.working.set(true);try{const d=await firstValueFrom(this.http.post<SavedPreview>('/api/ai/migration-previews',{...body,requestKey:this.requestKey}));this.requestKey='';this.requestBody='';await this.load();await this.open(d.id);this.toast.success(this.t('aiMigration.saved'));}catch(e){this.toast.errorFrom(e,this.t('aiMigration.error'));}finally{this.working.set(false);}}
 protected async record(){const d=this.saved(),r=this.selected();if(!d||!r||this.working()||!this.context()?.canPropose)return;this.working.set(true);try{await firstValueFrom(this.http.post(`/api/ai/migration-previews/${d.id}/dispositions`,{rowKey:r.key,outcome:this.outcome(),expectedDigest:d.digest,justification:this.justification(),evidenceIds:this.ids()}));await this.open(d.id);this.toast.success(this.t('aiMigration.recorded'));}catch(e){this.toast.errorFrom(e,this.t('aiMigration.error'));}finally{this.working.set(false);}}
 protected async review(outcome:string){const d=this.saved();if(!d||this.working()||!this.context()?.canReview)return;this.working.set(true);try{await firstValueFrom(this.http.post(`/api/ai/migration-previews/${d.id}/review`,{outcome,expectedDigest:d.digest,justification:this.justification(),evidenceIds:this.ids()}));await this.load(this.archive()?.page??1);await this.open(d.id);this.toast.success(this.t('aiMigration.recorded'));}catch(e){this.toast.errorFrom(e,this.t('aiMigration.error'));}finally{this.working.set(false);}}
 protected async download(format:string){const d=this.saved();if(!d||this.working())return;this.working.set(true);try{const b=await firstValueFrom(this.http.get(`/api/ai/migration-previews/${d.id}/export?format=${format}`,{responseType:'blob'})),url=URL.createObjectURL(b),a=document.createElement('a');a.href=url;a.download='dgop-ai-source-preview.'+format;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}catch(e){this.toast.errorFrom(e,this.t('aiMigration.error'));}finally{this.working.set(false);}}
}
