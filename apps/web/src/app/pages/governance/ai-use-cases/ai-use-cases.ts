import { AiJourneyHistory } from '../../../shared/ai-journey-history';
import { ChangeDetectionStrategy, Component, OnInit, computed, inject, signal } from '@angular/core';
import { DatePipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';
import { AuthService } from '../../../core/auth.service';
import { I18nService } from '../../../core/i18n.service';
import { AppIcon } from '../../../shared/app-icon';
import { StatusChip } from '../../../shared/status-chip';
import { ToastService } from '../../../shared/toast.service';

type FieldKind = 'text' | 'textarea' | 'date' | 'decimal' | 'select' | 'multiselect'
  | 'user' | 'boolean-detail' | 'constraints' | 'attachments';

interface IntakeFieldDefinition {
  code: string;
  kind: FieldKind;
  required: boolean;
  wide?: boolean;
  maxLength?: number;
}

interface IntakeSectionDefinition {
  number: number;
  fields: IntakeFieldDefinition[];
}

interface ReferenceValue { code: string; labelEn: string; labelAr: string; }
interface DirectoryUser {
  id: string;
  personId: string;
  email: string;
  displayName: string;
  nameEn: string;
  nameAr: string;
  roles: string[];
  expectedRole?: boolean;
}
interface IntakeLookups {
  ready: boolean;
  missingLists: string[];
  lists: Record<string, { listCode: string; versionId: string; values: ReferenceValue[] }>;
  proposedOwners: DirectoryUser[];
  dataOwners: DirectoryUser[];
  executiveSponsors: DirectoryUser[];
}
interface IntakeWarning { field: string; code: string; message: string; }
interface IntakeRevision {
  id: string;
  revision: number;
  schemaVersion: number;
  payload: Record<string, unknown>;
  submittedAt?: string | null;
  createdAt: string;
}
interface AiUseCase {
  id: string;
  useCaseRef?: string | null;
  workflowCaseId?: string | null;
  requesterUserId: string;
  name: string;
  description?: string | null;
  version: number;
  createdAt: string;
  updatedAt: string;
  workflowCase?: { id: string; code: string; status: string; type: string } | null;
  intakeRevisions: IntakeRevision[];
  warnings?: IntakeWarning[];
  conditions?: { personalDataInvolved: boolean; sensitiveDataInvolved: boolean };
}
interface ValidationIssue { field: string; code: string; message: string; }

const REQUIRED = true;
const OPTIONAL = false;
const SECTIONS: IntakeSectionDefinition[] = [
  { number: 1, fields: [
    { code: 'request_date', kind: 'date', required: REQUIRED },
    { code: 'requester', kind: 'user', required: REQUIRED },
    { code: 'usecase_name', kind: 'text', required: REQUIRED, maxLength: 200 },
    { code: 'proposed_owner', kind: 'user', required: REQUIRED },
    { code: 'strategic_streams', kind: 'multiselect', required: REQUIRED, wide: true },
    { code: 'values_alignment', kind: 'textarea', required: REQUIRED, wide: true },
    { code: 'program_platform', kind: 'select', required: REQUIRED },
  ] },
  { number: 2, fields: [
    { code: 'problem_desc', kind: 'textarea', required: REQUIRED, wide: true },
    { code: 'beneficiary_group', kind: 'text', required: REQUIRED, maxLength: 500 },
    { code: 'current_state', kind: 'textarea', required: REQUIRED, wide: true },
  ] },
  { number: 3, fields: [
    { code: 'objective_value', kind: 'textarea', required: REQUIRED, wide: true },
    { code: 'success_kpi', kind: 'text', required: REQUIRED, maxLength: 200 },
    { code: 'kpi_baseline', kind: 'decimal', required: REQUIRED },
    { code: 'kpi_target', kind: 'decimal', required: REQUIRED },
  ] },
  { number: 4, fields: [
    { code: 'simpler_alternatives', kind: 'boolean-detail', required: REQUIRED, wide: true },
    { code: 'existing_solutions_check', kind: 'boolean-detail', required: REQUIRED, wide: true },
  ] },
  { number: 5, fields: [
    { code: 'human_role', kind: 'select', required: REQUIRED },
    { code: 'target_stage', kind: 'select', required: REQUIRED },
    { code: 'execution_model', kind: 'select', required: REQUIRED },
  ] },
  { number: 6, fields: [
    { code: 'data_source', kind: 'text', required: REQUIRED, maxLength: 500, wide: true },
    { code: 'data_owner', kind: 'user', required: REQUIRED },
    { code: 'data_availability', kind: 'select', required: REQUIRED },
    { code: 'personal_data_flag', kind: 'select', required: REQUIRED },
    { code: 'data_classification', kind: 'select', required: REQUIRED },
  ] },
  { number: 7, fields: [
    { code: 'budget_band', kind: 'select', required: REQUIRED },
    { code: 'executive_sponsor', kind: 'user', required: REQUIRED },
  ] },
  { number: 8, fields: [
    { code: 'constraints_dependencies', kind: 'constraints', required: OPTIONAL, wide: true },
  ] },
  { number: 9, fields: [
    { code: 'attachments', kind: 'attachments', required: OPTIONAL, wide: true },
  ] },
];

@Component({
  selector: 'app-ai-use-cases',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [AiJourneyHistory, DatePipe, FormsModule, AppIcon, StatusChip],
  templateUrl: './ai-use-cases.html',
  styleUrl: './ai-use-cases.scss',
})
export class AiUseCasesPage implements OnInit {
  private readonly http = inject(HttpClient);
  private readonly auth = inject(AuthService);
  private readonly toast = inject(ToastService);
  protected readonly i18n = inject(I18nService);
  protected readonly sections = SECTIONS;
  protected readonly state = signal<'loading' | 'ok' | 'error'>('loading');
  protected readonly cases = signal<AiUseCase[]>([]);
  protected readonly selected = signal<AiUseCase | null>(null);
  protected readonly payload = signal<Record<string, any>>({});
  protected readonly lookups = signal<IntakeLookups | null>(null);
  protected readonly saving = signal(false);
  protected readonly dirty = signal(false);
  protected readonly issues = signal<ValidationIssue[]>([]);
  protected readonly warnings = signal<IntakeWarning[]>([]);
  protected readonly attachmentInput = signal('');
  protected readonly requiredTotal = 26;
  protected readonly isReadOnly = computed(() => {
    const workflow = this.selected()?.workflowCase;
    return !!workflow && workflow.status !== 'awaiting_information';
  });
  protected readonly completedRequired = computed(() => {
    let completed = 0;
    for (const field of SECTIONS.flatMap(section => section.fields).filter(field => field.required)) {
      if (this.hasValue(this.payload()[field.code])) completed++;
    }
    return completed;
  });

  ngOnInit(): void {
    void this.load();
  }

  protected t(key: string): string { return this.i18n.t(key); }
  protected fieldLabel(code: string): string { return this.t(`aiuc.field.${code}`); }
  protected sectionLabel(number: number): string { return this.t(`aiuc.section.${number}`); }
  protected value(code: string): any { return this.payload()[code]; }
  protected fieldIssues(code: string): ValidationIssue[] { return this.issues().filter(issue => issue.field === code); }

  protected async load(preferredId?: string): Promise<void> {
    this.state.set('loading');
    try {
      const [cases, lookups] = await Promise.all([
        firstValueFrom(this.http.get<AiUseCase[]>('/api/ai/use-cases')),
        firstValueFrom(this.http.get<IntakeLookups>('/api/ai/use-cases/lookups')),
      ]);
      this.cases.set(cases);
      this.lookups.set(lookups);
      const target = cases.find(row => row.id === preferredId)
        ?? cases.find(row => row.id === this.selected()?.id)
        ?? cases[0]
        ?? null;
      this.selectCase(target);
      this.state.set('ok');
    } catch (error) {
      this.state.set('error');
      this.toast.errorFrom(error, this.t('aiuc.error.load'));
    }
  }

  protected selectCase(item: AiUseCase | null): void {
    this.selected.set(item);
    this.payload.set(item?.intakeRevisions[0]?.payload ? structuredClone(item.intakeRevisions[0].payload) : {});
    this.warnings.set(item?.warnings ?? []);
    this.issues.set([]);
    this.dirty.set(false);
    this.attachmentInput.set('');
  }

  protected async createDraft(): Promise<void> {
    if (this.saving()) return;
    this.saving.set(true);
    try {
      const created = await firstValueFrom(this.http.post<AiUseCase>('/api/ai/use-cases', { payload: {} }));
      this.cases.update(rows => [created, ...rows]);
      this.selectCase(created);
      this.toast.success(this.t('aiuc.saved.created'));
    } catch (error) {
      this.handleError(error, 'aiuc.error.create');
    } finally {
      this.saving.set(false);
    }
  }

  protected updateField(code: string, value: unknown, kind?: FieldKind): void {
    const normalized = kind === 'decimal' && value !== '' && value !== null && value !== undefined ? String(value) : value;
    this.payload.update(current => ({ ...current, [code]: normalized }));
    this.issues.update(rows => rows.filter(issue => issue.field !== code));
    this.dirty.set(true);
  }

  protected updateBoolean(code: string, answer: string): void {
    const textKey = code === 'simpler_alternatives' ? 'justification' : 'details';
    const current = (this.value(code) ?? {}) as Record<string, unknown>;
    this.updateField(code, { ...current, answer: answer === 'true', [textKey]: current[textKey] ?? '' });
  }

  protected updateBooleanText(code: string, text: string): void {
    const textKey = code === 'simpler_alternatives' ? 'justification' : 'details';
    const current = (this.value(code) ?? {}) as Record<string, unknown>;
    this.updateField(code, { answer: current['answer'] ?? false, ...current, [textKey]: text });
  }

  protected booleanAnswer(code: string): string {
    const answer = (this.value(code) as { answer?: boolean } | undefined)?.answer;
    return answer === undefined ? '' : String(answer);
  }

  protected booleanText(code: string): string {
    const item = this.value(code) as { justification?: string; details?: string } | undefined;
    return item?.justification ?? item?.details ?? '';
  }

  protected setConstraintsNone(none: boolean): void {
    const current = this.value('constraints_dependencies') as { text?: string; none?: boolean } | undefined;
    this.updateField('constraints_dependencies', { text: none ? '' : current?.text ?? '', none });
  }

  protected setConstraintsText(text: string): void {
    this.updateField('constraints_dependencies', { text, none: false });
  }

  protected options(code: string): ReferenceValue[] {
    return this.lookups()?.lists[code]?.values ?? [];
  }

  protected usersFor(code: string): DirectoryUser[] {
    const lookup = this.lookups();
    if (!lookup) return [];
    if (code === 'proposed_owner') return lookup.proposedOwners;
    if (code === 'data_owner') return lookup.dataOwners;
    return lookup.executiveSponsors;
  }

  protected optionLabel(option: ReferenceValue): string {
    return this.i18n.lang() === 'ar' ? option.labelAr : option.labelEn;
  }

  protected userLabel(user: DirectoryUser): string {
    const name = this.i18n.lang() === 'ar' ? user.nameAr : user.nameEn;
    return `${name} · ${user.email}`;
  }

  protected requesterLabel(): string {
    return this.auth.currentUser()?.displayName ?? String(this.value('requester') ?? '');
  }

  protected addAttachment(): void {
    const id = this.attachmentInput().trim();
    if (!id) return;
    const attachments = Array.isArray(this.value('attachments')) ? [...this.value('attachments')] : [];
    if (!attachments.includes(id)) attachments.push(id);
    this.updateField('attachments', attachments);
    this.attachmentInput.set('');
  }

  protected removeAttachment(id: string): void {
    const attachments = Array.isArray(this.value('attachments')) ? this.value('attachments') : [];
    this.updateField('attachments', attachments.filter((value: string) => value !== id));
  }

  protected async save(): Promise<AiUseCase | null> {
    const item = this.selected();
    if (!item || this.isReadOnly() || this.saving()) return item;
    this.saving.set(true);
    this.issues.set([]);
    try {
      const saved = await firstValueFrom(this.http.patch<AiUseCase>(`/api/ai/use-cases/${item.id}/intake`, {
        expectedVersion: item.version,
        changes: this.payload(),
      }));
      this.replaceCase(saved);
      this.selectCase(saved);
      this.toast.success(this.t('aiuc.saved.draft'));
      return saved;
    } catch (error) {
      this.handleError(error, 'aiuc.error.save');
      return null;
    } finally {
      this.saving.set(false);
    }
  }

  protected async submit(): Promise<void> {
    let item = this.selected();
    if (!item || this.isReadOnly() || this.saving() || !this.lookups()?.ready) return;
    if (this.dirty()) {
      item = await this.save();
      if (!item) return;
    }
    this.saving.set(true);
    this.issues.set([]);
    try {
      const operation = item.workflowCase?.status === 'awaiting_information' ? 'resubmit' : 'submit';
      const submitted = await firstValueFrom(this.http.post<AiUseCase>(`/api/ai/use-cases/${item.id}/${operation}`, {
        expectedVersion: item.version,
      }));
      this.replaceCase(submitted);
      this.selectCase(submitted);
      this.toast.success(this.t('aiuc.saved.submitted'));
    } catch (error) {
      this.handleError(error, 'aiuc.error.submit');
    } finally {
      this.saving.set(false);
    }
  }

  protected statusLabel(item: AiUseCase): string {
    return item.workflowCase?.status ? this.t(`aiuc.status.${item.workflowCase.status}`) : this.t('aiuc.status.draft');
  }

  protected statusKind(item: AiUseCase): 'muted' | 'info' | 'success' {
    return item.workflowCase?.status === 'submitted' ? 'info' : item.workflowCase ? 'success' : 'muted';
  }

  private replaceCase(item: AiUseCase): void {
    this.cases.update(rows => rows.map(row => row.id === item.id ? item : row));
  }

  private handleError(error: unknown, fallbackKey: string): void {
    const response = error as HttpErrorResponse;
    const issues = response.error?.issues;
    if (Array.isArray(issues)) this.issues.set(issues);
    this.toast.errorFrom(error, this.t(fallbackKey));
  }

  private hasValue(value: unknown): boolean {
    if (typeof value === 'string') return !!value.trim();
    if (Array.isArray(value)) return value.length > 0;
    if (value && typeof value === 'object') {
      if ('answer' in value) {
        const record = value as Record<string, unknown>;
        return typeof record['answer'] === 'boolean' && !!String(record['justification'] ?? record['details'] ?? '').trim();
      }
    }
    return value !== null && value !== undefined;
  }
}
