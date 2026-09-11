import { ChangeDetectionStrategy, Component, OnInit, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { HttpClient } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';
import { I18nService } from '../../../core/i18n.service';
import { AppIcon } from '../../../shared/app-icon';
import { StatusChip } from '../../../shared/status-chip';
import { ToastService } from '../../../shared/toast.service';

type ReviewTab = 'triage' | 'classification';
type CriterionCode = 'individual_impact' | 'affected_scope' | 'harm_likelihood' | 'decision_autonomy'
  | 'data_fairness_transparency' | 'technical_resilience';

interface AiReviewCase {
  id: string;
  useCaseRef?: string | null;
  name: string;
  description?: string | null;
  version: number;
  updatedAt: string;
  workflowCase: { id: string; code: string; status: string };
  intakeRevisions: Array<{ payload: Record<string, unknown>; revision: number }>;
}

interface ScoreOption {
  code: string;
  labelEn: string;
  labelAr: string;
  score?: number;
  anchors?: Record<string, { labelEn?: string; labelAr?: string; descriptionEn?: string; descriptionAr?: string }>;
}

interface TierOption {
  code: string;
  labelEn: string;
  labelAr: string;
  minScore?: number;
  maxScore?: number;
  automatic?: boolean;
}

interface ClassificationConfiguration {
  ready: boolean;
  issues: string[];
  criteria: CriterionCode[];
  scoreVersionId?: string | null;
  tierVersionId?: string | null;
  scores: ScoreOption[];
  tiers: TierOption[];
}

const CRITERIA: CriterionCode[] = [
  'individual_impact', 'affected_scope', 'harm_likelihood', 'decision_autonomy',
  'data_fairness_transparency', 'technical_resilience',
];

const INTAKE_FIELDS = [
  'request_date', 'requester', 'usecase_name', 'proposed_owner', 'strategic_streams', 'values_alignment',
  'program_platform', 'problem_desc', 'beneficiary_group', 'current_state', 'objective_value', 'success_kpi',
  'kpi_baseline', 'kpi_target', 'simpler_alternatives', 'existing_solutions_check', 'human_role', 'target_stage',
  'execution_model', 'data_source', 'data_owner', 'data_availability', 'personal_data_flag', 'data_classification',
  'budget_band', 'executive_sponsor', 'constraints_dependencies', 'attachments',
];

@Component({
  selector: 'app-ai-review',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule, AppIcon, StatusChip],
  templateUrl: './ai-review.html',
  styleUrl: './ai-review.scss',
})
export class AiReviewPage implements OnInit {
  private readonly http = inject(HttpClient);
  private readonly toast = inject(ToastService);
  protected readonly i18n = inject(I18nService);
  protected readonly criteria = CRITERIA;
  protected readonly intakeFields = INTAKE_FIELDS;
  protected readonly state = signal<'loading' | 'ok' | 'error'>('loading');
  protected readonly tab = signal<ReviewTab>('triage');
  protected readonly triageCases = signal<AiReviewCase[]>([]);
  protected readonly classificationCases = signal<AiReviewCase[]>([]);
  protected readonly selected = signal<AiReviewCase | null>(null);
  protected readonly configuration = signal<ClassificationConfiguration | null>(null);
  protected readonly justification = signal('');
  protected readonly scores = signal<Record<string, { value: number | null; justification: string }>>({});
  protected readonly working = signal(false);
  protected readonly scoreMax = computed(() => {
    const values = CRITERIA.map(criterion => this.scores()[criterion]?.value).filter((value): value is number => typeof value === 'number');
    return values.length ? Math.max(...values) : null;
  });
  protected readonly proposedTier = computed(() => {
    const max = this.scoreMax();
    if (max === null) return null;
    return this.configuration()?.tiers.find(tier => tier.automatic && tier.minScore !== undefined && tier.maxScore !== undefined
      && max >= tier.minScore && max <= tier.maxScore) ?? null;
  });
  protected readonly assessmentComplete = computed(() => CRITERIA.every(criterion => {
    const score = this.scores()[criterion];
    return typeof score?.value === 'number' && !!score.justification.trim();
  }));

  ngOnInit(): void { void this.load(); }

  protected t(key: string): string { return this.i18n.t(key); }
  protected fieldLabel(code: string): string { return this.t(`aiuc.field.${code}`); }
  protected criterionLabel(code: string): string { return this.t(`aiReview.criterion.${code}`); }

  protected async load(preferredId?: string): Promise<void> {
    this.state.set('loading');
    try {
      const [triage, classification, configuration] = await Promise.all([
        firstValueFrom(this.http.get<AiReviewCase[]>('/api/ai/use-cases/triage')),
        firstValueFrom(this.http.get<AiReviewCase[]>('/api/ai/use-cases/classification/queue')),
        firstValueFrom(this.http.get<ClassificationConfiguration>('/api/ai/use-cases/classification/configuration')),
      ]);
      this.triageCases.set(triage);
      this.classificationCases.set(classification);
      this.configuration.set(configuration);
      const rows = this.tab() === 'triage' ? triage : classification;
      this.select(rows.find(row => row.id === preferredId) ?? rows[0] ?? null);
      this.state.set('ok');
    } catch (error) {
      this.state.set('error');
      this.toast.errorFrom(error, this.t('aiReview.error.load'));
    }
  }

  protected setTab(tab: ReviewTab): void {
    this.tab.set(tab);
    const rows = tab === 'triage' ? this.triageCases() : this.classificationCases();
    this.select(rows[0] ?? null);
  }

  protected select(item: AiReviewCase | null): void {
    this.selected.set(item);
    this.justification.set('');
    this.scores.set(Object.fromEntries(CRITERIA.map(criterion => [criterion, { value: null, justification: '' }])));
  }

  protected payload(): Record<string, unknown> { return this.selected()?.intakeRevisions[0]?.payload ?? {}; }

  protected renderValue(value: unknown): string {
    if (value === null || value === undefined || value === '') return this.t('aiReview.notProvided');
    if (Array.isArray(value)) return value.length ? value.join(', ') : this.t('aiReview.notProvided');
    if (typeof value === 'object') {
      const record = value as Record<string, unknown>;
      if (typeof record['answer'] === 'boolean') {
        const answer = record['answer'] ? this.t('aiuc.yes') : this.t('aiuc.no');
        return `${answer} · ${String(record['justification'] ?? record['details'] ?? '')}`;
      }
      if (record['none'] === true) return this.t('aiuc.none');
      return String(record['text'] ?? JSON.stringify(record));
    }
    return String(value);
  }

  protected async decide(decision: 'accept' | 'return' | 'reject'): Promise<void> {
    const item = this.selected();
    if (!item || this.working()) return;
    if (decision !== 'accept' && !this.justification().trim()) {
      this.toast.error(this.t('aiReview.justificationRequired'));
      return;
    }
    this.working.set(true);
    try {
      await firstValueFrom(this.http.post(`/api/ai/use-cases/${item.id}/triage`, {
        expectedVersion: item.version,
        decision,
        justification: this.justification().trim() || undefined,
      }));
      this.toast.success(this.t(`aiReview.decision.${decision}.saved`));
      if (decision === 'accept') this.tab.set('classification');
      await this.load(decision === 'accept' ? item.id : undefined);
    } catch (error) {
      this.toast.errorFrom(error, this.t('aiReview.error.decision'));
    } finally {
      this.working.set(false);
    }
  }

  protected setScore(criterion: CriterionCode, value: string): void {
    this.scores.update(current => ({
      ...current,
      [criterion]: { ...current[criterion], value: value ? Number(value) : null },
    }));
  }

  protected setJustification(criterion: CriterionCode, justification: string): void {
    this.scores.update(current => ({
      ...current,
      [criterion]: { ...current[criterion], justification },
    }));
  }

  protected optionLabel(option: { labelEn: string; labelAr: string }): string {
    return this.i18n.lang() === 'ar' ? option.labelAr : option.labelEn;
  }

  protected selectedScore(criterion: CriterionCode): number | null { return this.scores()[criterion]?.value ?? null; }
  protected scoreJustification(criterion: CriterionCode): string { return this.scores()[criterion]?.justification ?? ''; }

  protected anchorText(criterion: CriterionCode): string {
    const value = this.selectedScore(criterion);
    const option = this.configuration()?.scores.find(score => score.score === value);
    const anchor = option?.anchors?.[criterion];
    if (!anchor) return '';
    return this.i18n.lang() === 'ar'
      ? anchor.descriptionAr ?? anchor.labelAr ?? ''
      : anchor.descriptionEn ?? anchor.labelEn ?? '';
  }

  protected async assess(): Promise<void> {
    const item = this.selected();
    const configuration = this.configuration();
    if (!item || !configuration?.ready || !this.assessmentComplete() || this.working()) return;
    this.working.set(true);
    try {
      await firstValueFrom(this.http.post(`/api/ai/use-cases/classification/${item.id}/assess`, {
        expectedVersion: item.version,
        input: {
          kind: 'classification',
          scores: CRITERIA.map(criterion => ({
            value: this.scores()[criterion].value,
            justification: this.scores()[criterion].justification.trim(),
          })),
        },
      }));
      this.toast.success(this.t('aiReview.assessment.saved'));
      await this.load();
    } catch (error) {
      this.toast.errorFrom(error, this.t('aiReview.error.assessment'));
    } finally {
      this.working.set(false);
    }
  }
}
