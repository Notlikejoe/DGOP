import { ChangeDetectionStrategy, Component, effect, inject, input, output, signal } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { FormsModule } from '@angular/forms';
import { firstValueFrom } from 'rxjs';
import { I18nService } from '../core/i18n.service';
import { ToastService } from './toast.service';
import { DualDatePipe } from './dual-date.pipe';
interface Closure {version:number;canWithdraw:boolean;canCloseNoAction:boolean;informationDueAt:string|null}
interface Reversal {version:number;canReverse:boolean;calculatedTierCode:string|null;approvedTierCode:string|null;scoreMax:number|null}
@Component({selector:'app-ai-request-controls',imports:[FormsModule,DualDatePipe],changeDetection:ChangeDetectionStrategy.OnPush,styleUrl:'./ai-journey-history.scss',template:`
 @if(closure()?.canWithdraw||closure()?.canCloseNoAction||reversal()?.canReverse){<section class="ds-card journey-panel"><details><summary>{{ t('aiRequestControls.title') }}</summary><p>{{ t('aiRequestControls.help') }}</p>
 @if(closure()?.informationDueAt){<p>{{ t('aiRequestControls.informationDue') }}: {{ closure()!.informationDueAt | dgopDualDate:'medium':i18n.lang() }}</p>}
 @if(reversal()?.canReverse){<p>{{ t('aiRequestControls.tier') }}: {{ t('aiRisk.tier.'+reversal()!.approvedTierCode) }} → {{ t('aiRisk.tier.'+reversal()!.calculatedTierCode) }} · {{ t('aiJourney.score') }}: {{ reversal()!.scoreMax }}</p>}
 <fieldset [disabled]="working()"><label>{{ t('aiAssessment.justification') }}<textarea rows="3" maxlength="5000" [(ngModel)]="justification"></textarea></label><label>{{ t('aiRisk.field.evidence') }}<textarea rows="2" [(ngModel)]="evidence"></textarea></label>
 @if(reversal()?.canReverse){<label>{{ t('aiRequestControls.authority') }}<input type="text" [(ngModel)]="authority" maxlength="5000"/></label>}
 <div class="journey-toolbar">@if(closure()?.canWithdraw){<button type="button" class="ds-btn ds-btn--ghost" [disabled]="!ready()" (click)="act('withdraw')">{{ t('aiRequestControls.withdraw') }}</button>}@if(closure()?.canCloseNoAction){<button type="button" class="ds-btn ds-btn--ghost" [disabled]="!ready()" (click)="act('closed_no_action')">{{ t('aiRequestControls.close') }}</button>}@if(reversal()?.canReverse){<button type="button" class="ds-btn ds-btn--ghost" [disabled]="!ready()||!authority.trim()" (click)="act('reverse')">{{ t('aiRequestControls.reverse') }}</button>}</div></fieldset>
 </details></section>}`,styles:[`fieldset{border:0;padding:0;display:grid;gap:.8rem}label{display:grid;gap:.4rem}textarea,input{font:inherit;width:100%;padding:.65rem;border:1px solid var(--border-color,#ccd3dd);border-radius:.5rem;color:inherit;background:var(--surface-card,#fff)}`]})
export class AiRequestControls {
 readonly useCaseId=input.required<string>();readonly version=input.required<number>();readonly changed=output<void>();private readonly http=inject(HttpClient);protected readonly i18n=inject(I18nService);private readonly toast=inject(ToastService);
 protected readonly closure=signal<Closure|null>(null);protected readonly reversal=signal<Reversal|null>(null);protected readonly working=signal(false);protected justification='';protected evidence='';protected authority='';private sequence=0;
 constructor(){effect(()=>{const id=this.useCaseId();this.version();this.justification='';this.evidence='';this.authority='';void this.load(id);});}
 protected t(key:string){return this.i18n.t(key);}
 private async load(id:string){const seq=++this.sequence;this.closure.set(null);this.reversal.set(null);const [c,r]=await Promise.allSettled([firstValueFrom(this.http.get<Closure>(`/api/ai/use-cases/${id}/closure`)),firstValueFrom(this.http.get<Reversal>(`/api/ai/use-cases/classification/${id}/reversal`))]);if(seq!==this.sequence)return;if(c.status==='fulfilled')this.closure.set(c.value);if(r.status==='fulfilled')this.reversal.set(r.value);}
 protected ready(){return !!this.justification.trim()&&this.evidenceIds().length>0;}
 private evidenceIds(){return [...new Set(this.evidence.split(/[\s,;]+/u).filter(Boolean))];}
 protected async act(action:'withdraw'|'closed_no_action'|'reverse'){if(this.working()||!this.ready())return;const id=this.useCaseId(),expectedVersion=action==='reverse'?this.reversal()?.version:this.closure()?.version;if(!expectedVersion)return;this.working.set(true);try{await firstValueFrom(this.http.post(action==='reverse'?`/api/ai/use-cases/classification/${id}/reversal`:`/api/ai/use-cases/${id}/closure`,{expectedVersion,justification:this.justification.trim(),evidenceIds:this.evidenceIds(),...(action==='reverse'?{authorityReference:this.authority.trim()}:{mode:action})}));this.toast.success(this.t('aiRequestControls.saved'));this.changed.emit();await this.load(id);}catch(e){this.toast.errorFrom(e,this.t('aiRequestControls.error'));}finally{this.working.set(false);}}
}
