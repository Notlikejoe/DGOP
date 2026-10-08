import { ChangeDetectionStrategy, Component, inject, OnInit, signal } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { FormsModule } from '@angular/forms';
import { firstValueFrom } from 'rxjs';
import { TableModule } from 'primeng/table';
import { DialogModule } from 'primeng/dialog';
import { AuthService } from '../../../core/auth.service';
import { I18nService } from '../../../core/i18n.service';
import { ToastService } from '../../../shared/toast.service';
interface Template {id:string;code:string;name:string;sourceType:string;titleTemplate:string;messageTemplate:string;digestCadence:string;defaultChannelsJson:string[];isActive:boolean}
@Component({selector:'app-ai-notification-config',imports:[FormsModule,TableModule,DialogModule],changeDetection:ChangeDetectionStrategy.OnPush,template:`
 @if(canConfigure()) {
 <section class="ds-card config-card"><details><summary>{{ t('aiNotices.settings') }}</summary>
 <p>{{ t('aiNotices.help') }}</p>
 @if(state()==='error'){<p role="alert">{{ t('aiNotices.error') }}</p><button class="ds-btn ds-btn--ghost" (click)="load()">{{ t('aiNotices.retry') }}</button>}
 <p-table [value]="rows()" [paginator]="rows().length>7" [rows]="7" [loading]="state()==='loading'" [tableStyle]="{'min-width':'36rem'}">
 <ng-template #header><tr><th>{{ t('aiNotices.code') }}</th><th>{{ t('aiNotices.subject') }}</th><th>{{ t('aiNotices.state') }}</th><th>{{ t('aiNotices.cadence') }}</th><th>{{ t('aiNotices.action') }}</th></tr></ng-template>
 <ng-template #body let-row><tr><td>{{ row.code }}</td><td>{{ subject(row) }}</td><td>{{ t(row.isActive?'aiNotices.active':'aiNotices.inactive') }}</td><td>{{ t('aiNotices.'+row.digestCadence) }}</td><td><button type="button" class="ds-btn ds-btn--ghost" (click)="edit(row)">{{ t('aiNotices.edit') }} {{ row.code }}</button></td></tr></ng-template>
 </p-table></details></section>
 <p-dialog [visible]="!!draft()" (visibleChange)="close($event)" [header]="t('aiNotices.edit')" [modal]="true" [style]="{width:'48rem','max-width':'95vw'}" [closable]="!working()" [closeOnEscape]="!working()">
 @if(draft();as d){<fieldset [disabled]="working()"><p>{{ d.code }}</p>
 <label>{{ t('aiNotices.subject') }}<textarea [ngModel]="d.titleTemplate" readonly rows="3"></textarea></label>
 <label>{{ t('aiNotices.body') }}<textarea [(ngModel)]="d.messageTemplate" rows="7" maxlength="1200"></textarea></label>
 <label>{{ t('aiNotices.cadence') }}<select [(ngModel)]="d.digestCadence">@for(c of ['immediate','hourly','daily','weekly'];track c){<option [value]="c">{{ t('aiNotices.'+c) }}</option>}</select></label>
 <label class="check"><input type="checkbox" [ngModel]="channel(d,'in_app')" (ngModelChange)="setChannel(d,'in_app',$event)"/>{{ t('aiNotices.inApp') }}</label>
 <label class="check"><input type="checkbox" [ngModel]="channel(d,'email')" (ngModelChange)="setChannel(d,'email',$event)"/>{{ t('aiNotices.email') }}</label>
 <label class="check"><input type="checkbox" [(ngModel)]="d.isActive"/>{{ t('aiNotices.enable') }}</label>
 <p>{{ t('aiNotices.deliveryHelp') }}</p><button type="button" class="ds-btn ds-btn--primary" [disabled]="!d.messageTemplate.trim()" (click)="save()">{{ t('aiNotices.save') }}</button></fieldset>}
 </p-dialog>
 }`,styles:[` .config-card{margin-block:1.25rem;padding:1.25rem}summary{cursor:pointer;font-weight:650;font-size:1.1rem}fieldset{border:0;padding:0;display:grid;gap:.85rem}label:not(.check){display:grid;gap:.4rem}textarea,select{width:100%;padding:.65rem;border:1px solid var(--border-color,#ccd3dd);border-radius:.5rem;font:inherit;background:var(--surface-card,#fff);color:inherit}textarea[readonly]{opacity:.85}.check{display:flex;gap:.6rem;align-items:center}p{line-height:1.5}`]})
export class AiNotificationConfig implements OnInit {
 private readonly http=inject(HttpClient);private readonly auth=inject(AuthService);protected readonly i18n=inject(I18nService);private readonly toast=inject(ToastService);
 protected readonly rows=signal<Template[]>([]);protected readonly state=signal<'loading'|'ok'|'error'>('loading');protected readonly draft=signal<Template|null>(null);protected readonly working=signal(false);
 protected canConfigure(){const roles=this.auth.currentUser()?.roles.map(role=>role.code)??[];return roles.includes('dmo_admin')&&!roles.includes('auditor')&&this.auth.hasPermission('governance_operations.edit');}
 protected t(key:string){return this.i18n.t(key);}
 protected subject(row:Template){return row.titleTemplate.split('\n')[this.i18n.lang()==='ar'?1:0]??row.titleTemplate;}
 ngOnInit(){if(this.canConfigure())void this.load();}
 protected async load(){this.state.set('loading');try{this.rows.set((await firstValueFrom(this.http.get<Template[]>('/api/governance-operations/notifications/templates'))).filter(t=>/^(AIUC|AIRS|AIX)-NTF-/.test(t.code)));this.state.set('ok');}catch{this.state.set('error');}}
 protected edit(row:Template){this.draft.set({...row,defaultChannelsJson:[...row.defaultChannelsJson]});}
 protected close(visible:boolean){if(!visible&&!this.working())this.draft.set(null);}
 protected channel(row:Template,c:string){return row.defaultChannelsJson.includes(c);}
 protected setChannel(row:Template,c:string,on:boolean){row.defaultChannelsJson=on?[...new Set([...row.defaultChannelsJson,c])]:row.defaultChannelsJson.filter(v=>v!==c);}
 protected async save(){const d=this.draft();if(!d||this.working()||!this.canConfigure())return;this.working.set(true);try{await firstValueFrom(this.http.post('/api/governance-operations/notifications/templates',{code:d.code,name:d.name,sourceType:d.sourceType,titleTemplate:d.titleTemplate,messageTemplate:d.messageTemplate,digestCadence:d.digestCadence,defaultChannelsJson:d.defaultChannelsJson,isActive:d.isActive}));this.draft.set(null);this.toast.success(this.t('aiNotices.saved'));await this.load();}catch(e){this.toast.errorFrom(e,this.t('aiNotices.error'));}finally{this.working.set(false);}}
}
