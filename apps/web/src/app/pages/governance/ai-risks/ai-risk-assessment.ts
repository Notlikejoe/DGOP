import { ChangeDetectionStrategy, Component, effect, inject, input, output, signal } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { FormsModule } from '@angular/forms';
import { firstValueFrom } from 'rxjs';
import { I18nService } from '../../../core/i18n.service';
import { ToastService } from '../../../shared/toast.service';
import { AppIcon } from '../../../shared/app-icon';
import { StatusChip } from '../../../shared/status-chip';

type Anchor = { en: string; ar: string };
interface AssessmentContext {
  eligible?: boolean; prerequisite?: string | null; planned?: number; completed?: number;
  controlReference?: { versionId: string; values: Array<{code:string;labelEn:string;labelAr:string}> };
  version: number; canStart: boolean; canComplete: boolean; started: boolean; canRestart: boolean; referencesCurrent: boolean;
  configuration: { ready: boolean; issues: string[]; scores: Array<{ score: number; anchors: { likelihood: Anchor; impact: Anchor } }>;
    dimensions: Array<{ dimension: string; labelEn: string; labelAr: string }> };
  tasks: Array<{ id: string; dimension: string; assessorRoleCode: string; status: string; canContribute: boolean;
    score: { value: number; justification: string } | null }>;
  rounds: Array<{ id: string; round: number; decisions: Array<{ kind: string; decision: string }>; result: { likelihood: number; impactFinal: number; impactTopDimension: string;
    tiedDimensions: string[]; score: number; bandCode: string; bandLabelEn: string; bandLabelAr: string; severityCode: string; ethicsReviewRequired: boolean; riskReductionPct?: number };
    inputs: { currentControls?: string; controlEffectiveness?: { code: string; labelEn: string; labelAr: string }; likelihood: { value: number; justification: string }; dimensions: Array<{ dimension: string; value: number; justification: string; assessedRoleCode: string }> } }>;
}
@Component({ selector: 'app-ai-risk-assessment', standalone: true, imports: [FormsModule, AppIcon, StatusChip],
  templateUrl: './ai-risk-assessment.html', styleUrls: ['../ai-review/ai-review.scss', './ai-risk-assessment.scss'], changeDetection: ChangeDetectionStrategy.OnPush })
export class AiRiskAssessment {
  readonly riskId = input.required<string>();
  readonly assessmentKind = input<'inherent' | 'residual'>('inherent');
  readonly updated = output<void>();
  private readonly http = inject(HttpClient);
  private readonly i18n = inject(I18nService);
  private readonly toast = inject(ToastService);
  protected readonly context = signal<AssessmentContext | null>(null);
  protected readonly state = signal<'loading' | 'ok' | 'error'>('loading');
  protected readonly working = signal(false);
  protected readonly likelihood = signal<number | null>(null);
  protected readonly justification = signal('');
  protected readonly restartJustification = signal('');
  protected readonly currentControls = signal('');
  protected readonly controlEffectiveness = signal('');
  protected readonly drafts = signal<Record<string, { value: number | null; justification: string }>>({});
  private loadSequence = 0;
  constructor() { effect(() => { void this.load(this.riskId()); }); }
  protected t(key: string): string { return this.i18n.t(key); }
  protected isResidual(): boolean { return this.assessmentKind() === 'residual'; }
  private endpoint(): string { return this.isResidual() ? 'residual' : 'assessment'; }
  protected roundStatus(round: AssessmentContext['rounds'][number]): string {
    if (this.isResidual()) return this.t('aiResidual.pendingReview');
    return this.t(round.decisions.some(value => value.decision === 'return') ? 'aiAdoption.decision.return'
      : round.decisions.some(value => value.kind === 'adoption' && value.decision === 'approve') ? 'aiAdoption.adopted' : 'aiAssessment.pendingAdoption');
  }
  protected bilingual(value: { labelEn: string; labelAr: string }): string { return this.i18n.lang() === 'ar' ? value.labelAr : value.labelEn; }
  protected reduction(value: number): string { return new Intl.NumberFormat(this.i18n.lang(), { maximumFractionDigits: 1 }).format(value) + '%'; }
  protected dimensionLabel(dimension: string): string {
    const value = this.context()?.configuration.dimensions.find(value => value.dimension === dimension);
    return value ? this.bilingual(value) : this.t('aiAssessment.dimension.' + dimension);
  }
  protected anchor(score: number | null, kind: 'likelihood' | 'impact'): string {
    const value = this.context()?.configuration.scores.find(value => value.score === score)?.anchors[kind];
    return value ? (this.i18n.lang() === 'ar' ? value.ar : value.en) : '';
  }
  protected patch(taskId: string, field: 'value' | 'justification', value: number | string | null): void {
    this.drafts.update(drafts => ({ ...drafts, [taskId]: { ...drafts[taskId], [field]: value } }));
  }
  protected async load(id = this.riskId()): Promise<void> {
    if (id !== this.riskId()) return;
    const sequence = ++this.loadSequence;
    this.state.set('loading'); this.context.set(null); this.likelihood.set(null); this.justification.set(''); this.currentControls.set(''); this.controlEffectiveness.set('');
    try {
      const context = await firstValueFrom(this.http.get<AssessmentContext>(`/api/ai/risks/${id}/${this.endpoint()}`));
      if (sequence !== this.loadSequence) return;
      this.context.set(context); this.drafts.set(Object.fromEntries(context.tasks.map(task => [task.id,
        { value: task.score?.value ?? null, justification: task.score?.justification ?? '' }]))); this.state.set('ok');
    } catch (error) { if (sequence === this.loadSequence) { this.state.set('error'); this.toast.errorFrom(error, this.t('aiAssessment.error')); } }
  }
  protected async start(): Promise<void> {
    const context = this.context();
    if (!context?.canStart) return;
    await this.mutate('start', { expectedVersion: context.version });
  }
  protected async contribute(taskId: string): Promise<void> {
    const context = this.context(), draft = this.drafts()[taskId];
    if (!context?.tasks.find(task => task.id === taskId)?.canContribute || !draft?.value || !draft.justification.trim()) return;
    await this.mutate(`tasks/${taskId}`, { expectedVersion: context.version, ...draft });
  }
  protected async complete(): Promise<void> {
    const context = this.context();
    if (!context?.canComplete || !this.likelihood() || !this.justification().trim()) return;
    if (this.isResidual() && (!this.currentControls().trim() || !this.controlEffectiveness())) return;
    await this.mutate('complete', { expectedVersion: context.version, likelihood: this.likelihood(), justification: this.justification().trim(),
      ...(this.isResidual() ? { currentControls: this.currentControls().trim(), controlEffectivenessCode: this.controlEffectiveness() } : {}) });
  }
  protected async restart(): Promise<void> {
    const context = this.context();
    if (!context?.canRestart || !this.restartJustification().trim()) return;
    await this.mutate('restart', { expectedVersion: context.version, justification: this.restartJustification().trim() });
  }
  private async mutate(path: string, body: unknown): Promise<void> {
    if (this.working()) return;
    this.working.set(true);
    const id = this.riskId();
    try { await firstValueFrom(this.http.post(`/api/ai/risks/${id}/${this.endpoint()}/${path}`, body));
      this.toast.success(this.t('aiAssessment.saved')); this.updated.emit();
    } catch (error) { this.toast.errorFrom(error, this.t('aiAssessment.error')); await this.load(id); }
    finally { this.working.set(false); }
  }
}
