import { ChangeDetectionStrategy, Component, effect, inject, input, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';
import { TableModule } from 'primeng/table';
import { AuthService } from '../core/auth.service';
import { I18nService } from '../core/i18n.service';
import { DualDatePipe } from './dual-date.pipe';
import { JsonPipe } from '@angular/common';
interface AuditPage {rows:Array<{id:string;action:string;entityId:string;createdAt:string;actor?:string;entryHash?:string;previousHash?:string;chainVersion?:number;metadata:{justification?:string;actorRoleCode?:string;oldValue?:string;newValue?:string}}>;
 total:number;page:number;pageSize:number}
@Component({selector:'app-ai-audit-query',standalone:true,imports:[FormsModule,TableModule,DualDatePipe,JsonPipe],changeDetection:ChangeDetectionStrategy.OnPush,
 templateUrl:'./ai-audit-query.html',styleUrl:'./ai-journey-history.scss'})
export class AiAuditQuery {
 readonly caseId=input('');readonly assetScopeId=input('');readonly kind=input<'airs'|'aiuc'|'all'>('airs');protected readonly auth=inject(AuthService);private readonly http=inject(HttpClient);protected readonly i18n=inject(I18nService);
 protected readonly data=signal<AuditPage|null>(null);protected readonly state=signal<'loading'|'ok'|'error'|'hidden'>('loading');protected readonly downloading=signal(false);
 protected actorId='';protected assetId='';protected from='';protected to='';protected allCases=false;protected fullDetails=false;private sequence=0;
 constructor(){effect(()=>{this.actorId='';this.assetId=this.assetScopeId();this.from='';this.to='';this.allCases=false;this.fullDetails=false;void this.load(this.caseId());});}
 protected t(key:string){return this.i18n.t(key);}
 protected eventLabel(action:string){const key='wf.event.'+action,label=this.t(key);return label===key?this.t('aiAudit.event'):label;}
 protected valueLabel(value:string|undefined){if(!value)return '—';for(const prefix of ['case.','aiRisk.tier.','aiAssessment.severity.']){const key=prefix+value,label=this.t(key);if(label!==key)return label;}return value;}
 private params(id:string,page:number){return {kind:this.kind(),detail:this.fullDetails?'full':'redacted',...(!this.allCases&&id?{caseId:id}:{}),...(this.actorId.trim()?{actorId:this.actorId.trim()}:{}),...(this.assetId.trim()?{assetId:this.assetId.trim()}:{}),
  ...(this.from?{from:new Date(this.from+'T00:00:00+03:00').toISOString()}:{}),...(this.to?{to:new Date(this.to+'T23:59:59.999+03:00').toISOString()}:{}),page,pageSize:20};}
 protected async load(id=this.caseId(),page=1){const sequence=++this.sequence;this.data.set(null);this.state.set('loading');
  try{const result=await firstValueFrom(this.http.get<AuditPage>('/api/ai/audit',{params:this.params(id,page)}));if(sequence===this.sequence){this.data.set(result);this.state.set('ok');}}
  catch(e){if(sequence===this.sequence)this.state.set(e instanceof HttpErrorResponse&&e.status===403?'hidden':'error');}
 }
 protected async download(){if(this.downloading()||!this.data())return;this.downloading.set(true);
  try{const blob=await firstValueFrom(this.http.get('/api/ai/audit/export',{params:this.params(this.caseId(),this.data()!.page),responseType:'blob'})),url=URL.createObjectURL(blob),link=document.createElement('a');link.href=url;link.download='DGOP-AI-audit-page.csv';link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}
  catch{this.state.set('error');}finally{this.downloading.set(false);}
 }
}
