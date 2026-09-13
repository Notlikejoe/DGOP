import { ChangeDetectionStrategy, Component, EventEmitter, inject, Input, OnInit, Output, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { HttpClient } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';
import { TableModule } from 'primeng/table';
import { I18nService } from '../../../core/i18n.service';
import { ToastService } from '../../../shared/toast.service';
export interface LibraryRow {entryId:string;versionId:string;libraryRef:string;round:number;content:Record<string,string>;published:boolean;createdAt:string;justification:string}
interface LibraryLookups {canPropose:boolean;canPublish:boolean;lists:Array<{field:string;ready:boolean;values:Array<{code:string;labelEn:string;labelAr:string}>}>}
@Component({selector:'app-ai-risk-library',standalone:true,imports:[FormsModule,TableModule],templateUrl:'./ai-risk-library.html',styleUrls:['../ai-review/ai-review.scss','../ai-reviews/ai-reviews.scss','./ai-risks.scss'],changeDetection:ChangeDetectionStrategy.OnPush})
export class AiRiskLibrary implements OnInit {
 @Input() allowChoose=false;
 @Output() chosen=new EventEmitter<LibraryRow>();
 private readonly http=inject(HttpClient);protected readonly i18n=inject(I18nService);private readonly toast=inject(ToastService);
 protected readonly state=signal<'loading'|'ok'|'error'>('loading');protected readonly working=signal(false);protected readonly search=signal('');
 protected readonly rows=signal<{rows:LibraryRow[];total:number;page:number;pageSize:number}>({rows:[],total:0,page:1,pageSize:20});protected readonly proposals=signal<LibraryRow[]>([]);
 protected readonly lookups=signal<LibraryLookups>({canPropose:false,canPublish:false,lists:[]});protected readonly selected=signal<LibraryRow|null>(null);
 protected readonly content=signal<Record<string,string>>({});protected readonly entryId=signal('');protected readonly round=signal(0);protected readonly editing=signal(false);protected readonly justification=signal('');protected readonly evidence=signal('');
 protected readonly fields=['titleEn','titleAr','risk_domain','description','probable_causes','probable_impacts','example_controls','attention_indicators'];private sequence=0;
 protected t(k:string){return this.i18n.t(k);}
 protected title(r:LibraryRow){return r.content[this.i18n.lang()==='ar'?'titleAr':'titleEn'];}
 protected option(r:{labelEn:string;labelAr:string}){return this.i18n.lang()==='ar'?r.labelAr:r.labelEn;}
 protected patch(k:string,v:string){this.content.update(c=>({...c,[k]:v}));}
 ngOnInit(){void this.load();}
 protected async load(page=1){const seq=++this.sequence;this.state.set('loading');try{const [rows,lookups]=await Promise.all([firstValueFrom(this.http.get<{rows:LibraryRow[];total:number;page:number;pageSize:number}>(`/api/ai/risk-library?page=${page}&search=${encodeURIComponent(this.search())}`)),firstValueFrom(this.http.get<LibraryLookups>('/api/ai/risk-library/lookups'))]);const proposals=lookups.canPropose||lookups.canPublish?await firstValueFrom(this.http.get<LibraryRow[]>('/api/ai/risk-library/proposals')):[];if(seq===this.sequence){this.rows.set(rows);this.lookups.set(lookups);this.proposals.set(proposals);this.state.set('ok');}}catch(e){if(seq===this.sequence){this.state.set('error');this.toast.errorFrom(e,this.t('aiLibrary.error'));}}}
 protected edit(r?:LibraryRow){this.entryId.set(r?.entryId??'');this.round.set(r?.round??0);this.content.set({...r?.content});this.justification.set('');this.evidence.set('');this.editing.set(true);}
 protected async propose(){if(!this.lookups().canPropose||this.working())return;this.working.set(true);try{await firstValueFrom(this.http.post('/api/ai/risk-library/proposals',{entryId:this.entryId()||undefined,expectedRound:this.round(),content:this.content(),justification:this.justification(),evidenceIds:[...new Set(this.evidence().split(/[\s,;]+/u).filter(Boolean))]}));this.editing.set(false);this.justification.set('');this.evidence.set('');this.toast.success(this.t('aiLibrary.proposed'));await this.load();}catch(e){this.toast.errorFrom(e,this.t('aiLibrary.error'));}finally{this.working.set(false);}}
 protected async publish(r:LibraryRow){if(!this.lookups().canPublish||this.working()||!this.justification().trim()||!this.evidence().trim())return;this.working.set(true);try{await firstValueFrom(this.http.post(`/api/ai/risk-library/versions/${r.versionId}/publish`,{justification:this.justification(),evidenceIds:[...new Set(this.evidence().split(/[\s,;]+/u).filter(Boolean))]}));this.justification.set('');this.evidence.set('');this.selected.set(null);this.toast.success(this.t('aiLibrary.published'));await this.load();}catch(e){this.toast.errorFrom(e,this.t('aiLibrary.error'));}finally{this.working.set(false);}}
}
