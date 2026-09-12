import { ChangeDetectionStrategy, Component, effect, inject, input, output, signal } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { FormsModule } from '@angular/forms';
import { firstValueFrom } from 'rxjs';
import { I18nService } from '../../../core/i18n.service';
import { ToastService } from '../../../shared/toast.service';
import { AppIcon } from '../../../shared/app-icon';
import { StatusChip } from '../../../shared/status-chip';
type Payload = { justification: string; provider: string; contractEvidenceIds: string[]; choice: { labelEn: string; labelAr: string }; offshoreProcessing: boolean };
interface ResponseContext {
  version: number; awaitingProposal: boolean; canPrepare: boolean; canPropose: boolean; consultationRequired: boolean; consulted: boolean; referencesCurrent: boolean;
  references: { ready: boolean; values: Array<{ code: string; labelEn: string; labelAr: string }> };
  response: { id: string; strategyCode: string; payload: Payload } | null;
  tasks: Array<{ id: string; kind: string; canApprove: boolean; canReturn: boolean }>;
  history: Array<{ id: string; round: number; strategyCode: string; payload: Payload;
    decisions: Array<{ id: string; kind: string; decision: string; justification: string }> }>;
}
@Component({ selector: 'app-ai-risk-response', standalone: true, imports: [FormsModule, AppIcon, StatusChip],
  templateUrl: './ai-risk-response.html', styleUrls: ['../ai-review/ai-review.scss', './ai-risk-assessment.scss'], changeDetection: ChangeDetectionStrategy.OnPush })
export class AiRiskResponse {
  readonly riskId = input.required<string>(); readonly updated = output<void>();
  private readonly http = inject(HttpClient); private readonly i18n = inject(I18nService); private readonly toast = inject(ToastService);
  protected readonly context = signal<ResponseContext | null>(null); protected readonly working = signal(false);
  protected readonly state = signal<'loading' | 'ok' | 'error'>('loading');
  protected readonly strategy = signal(''); protected readonly justification = signal(''); protected readonly evidence = signal('');
  protected readonly provider = signal(''); protected readonly contracts = signal(''); protected readonly offshore = signal(false);
  protected readonly drafts = signal<Record<string, { justification: string; evidence: string }>>({}); private sequence = 0;
  constructor() { effect(() => { void this.load(this.riskId()); }); }
  protected t(key: string): string { return this.i18n.t(key); }
  protected label(value: { labelEn: string; labelAr: string }): string { return this.i18n.lang() === 'ar' ? value.labelAr : value.labelEn; }
  protected patch(id: string, field: 'justification' | 'evidence', value: string): void {
    this.drafts.update(drafts => ({ ...drafts, [id]: { ...drafts[id], [field]: value } }));
  }
  protected async load(id = this.riskId()): Promise<void> {
    if (id !== this.riskId()) return;
    const sequence = ++this.sequence; this.state.set('loading'); this.context.set(null);
    this.strategy.set(''); this.justification.set(''); this.evidence.set(''); this.provider.set(''); this.contracts.set(''); this.offshore.set(false);
    try { const context = await firstValueFrom(this.http.get<ResponseContext>(`/api/ai/risks/${id}/response`));
      if (sequence !== this.sequence) return;
      this.context.set(context); this.drafts.set(Object.fromEntries(context.tasks.map(task => [task.id, { justification: '', evidence: '' }]))); this.state.set('ok');
    } catch (error) { if (sequence === this.sequence) { this.state.set('error'); this.toast.errorFrom(error, this.t('aiResponse.error')); } }
  }
  protected async prepare(): Promise<void> { if (this.context()?.canPrepare) await this.mutate('prepare', { expectedVersion: this.context()!.version }); }
  private identifiers(value: string): string[] { return [...new Set(value.split(/[\s,;]+/u).filter(Boolean))]; }
  protected async propose(): Promise<void> {
    const context = this.context(); if (!context?.canPropose || !this.strategy() || !this.justification().trim() || !this.evidence().trim()) return;
    await this.mutate('propose', { expectedVersion: context.version, strategyCode: this.strategy(), justification: this.justification().trim(),
      evidenceIds: this.identifiers(this.evidence()), offshoreProcessing: this.offshore(), provider: this.strategy() === 'TRANSFER' ? this.provider().trim() : '',
      contractEvidenceIds: this.strategy() === 'TRANSFER' ? this.identifiers(this.contracts()) : [] });
  }
  protected async decide(id: string, decision: 'approve' | 'return'): Promise<void> {
    const context = this.context(), task = context?.tasks.find(task => task.id === id), draft = this.drafts()[id];
    if (!task || !(decision === 'approve' ? task.canApprove : task.canReturn) || !draft?.justification.trim() || !draft.evidence.trim()) return;
    await this.mutate(`tasks/${id}`, { expectedVersion: context!.version, decision, justification: draft.justification.trim(), evidenceIds: this.identifiers(draft.evidence) });
  }
  private async mutate(path: string, body: unknown): Promise<void> {
    if (this.working()) return; this.working.set(true); const id = this.riskId();
    try { await firstValueFrom(this.http.post(`/api/ai/risks/${id}/response/${path}`, body)); this.toast.success(this.t('aiResponse.saved')); this.updated.emit(); }
    catch (error) { this.toast.errorFrom(error, this.t('aiResponse.error')); await this.load(id); } finally { this.working.set(false); }
  }
}
