import { AiEvidencePanel } from '../../../shared/ai-evidence-panel';
import { ChangeDetectionStrategy, Component, effect, inject, input, output, signal } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { FormsModule } from '@angular/forms';
import { firstValueFrom } from 'rxjs';
import { I18nService } from '../../../core/i18n.service';
import { ToastService } from '../../../shared/toast.service';
import { AppIcon } from '../../../shared/app-icon';
import { StatusChip } from '../../../shared/status-chip';

interface AdoptionContext {
  version: number; assessmentId: string | null; round: number | null; ethicsRequired: boolean; ethicsApproved: boolean;
  referencesCurrent: boolean; recused: boolean; canPrepare: boolean;
  tasks: Array<{ id: string; kind: 'ethics' | 'adoption'; canReturn: boolean; canApprove: boolean }>;
  history: Array<{ id: string; round: number; decisions: Array<{ id: string; kind: string; decision: string;
    actorRoleCode: string; justification: string; evidenceIds: string[]; createdAt: string }> }>;
}
@Component({ selector: 'app-ai-risk-adoption', standalone: true, imports:[AiEvidencePanel,FormsModule, AppIcon, StatusChip],
  templateUrl: './ai-risk-adoption.html', styleUrls: ['../ai-review/ai-review.scss', './ai-risk-assessment.scss'], changeDetection: ChangeDetectionStrategy.OnPush })
export class AiRiskAdoption {
  readonly riskId = input.required<string>();
  readonly updated = output<void>();
  private readonly http = inject(HttpClient);
  private readonly i18n = inject(I18nService);
  private readonly toast = inject(ToastService);
  protected readonly context = signal<AdoptionContext | null>(null);
  protected readonly state = signal<'loading' | 'ok' | 'error'>('loading');
  protected readonly working = signal(false);
  protected readonly drafts = signal<Record<string, { justification: string; evidence: string }>>({});
  private sequence = 0;
  constructor() { effect(() => { void this.load(this.riskId()); }); }
  protected t(key: string): string { return this.i18n.t(key); }
  protected patch(id: string, field: 'justification' | 'evidence', value: string): void {
    this.drafts.update(drafts => ({ ...drafts, [id]: { ...drafts[id], [field]: value } }));
  }
  protected async load(id = this.riskId()): Promise<void> {
    if (id !== this.riskId()) return;
    const sequence = ++this.sequence;
    this.context.set(null); this.state.set('loading'); this.drafts.set({});
    try {
      const context = await firstValueFrom(this.http.get<AdoptionContext>(`/api/ai/risks/${id}/assessment/adoption`));
      if (sequence !== this.sequence) return;
      this.context.set(context); this.drafts.set(Object.fromEntries(context.tasks.map(task => [task.id, { justification: '', evidence: '' }]))); this.state.set('ok');
    } catch (error) { if (sequence === this.sequence) { this.state.set('error'); this.toast.errorFrom(error, this.t('aiAdoption.error')); } }
  }
  protected async prepare(): Promise<void> {
    if (!this.context()?.canPrepare) return;
    await this.mutate('adoption/prepare', { expectedVersion: this.context()!.version });
  }
  protected async review(id: string, decision: 'approve' | 'return'): Promise<void> {
    const context = this.context(), task = context?.tasks.find(task => task.id === id), draft = this.drafts()[id];
    if (!task || !(decision === 'approve' ? task.canApprove : task.canReturn) || !draft?.justification.trim()) return;
    const evidenceIds = [...new Set(draft.evidence.split(/[\s,;]+/u).filter(Boolean))];
    if (!evidenceIds.length) return;
    await this.mutate(`reviews/${id}`, { expectedVersion: context!.version, decision, justification: draft.justification.trim(), evidenceIds });
  }
  private async mutate(path: string, body: unknown): Promise<void> {
    if (this.working()) return;
    this.working.set(true); const id = this.riskId();
    try { await firstValueFrom(this.http.post(`/api/ai/risks/${id}/assessment/${path}`, body));
      this.toast.success(this.t('aiAdoption.saved')); this.updated.emit();
    } catch (error) { this.toast.errorFrom(error, this.t('aiAdoption.error')); await this.load(id); }
    finally { this.working.set(false); }
  }
}
