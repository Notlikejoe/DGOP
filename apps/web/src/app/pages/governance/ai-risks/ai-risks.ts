import { AiAuditQuery } from '../../../shared/ai-audit-query';
import { AiSeverity } from './ai-severity';
import { AiRiskStrategy } from './ai-risk-strategy';
import { AiJourneyHistory } from '../../../shared/ai-journey-history';
import { AiControlPicker, ControlTag } from './ai-control-picker';
import { AiRiskInitiation } from './ai-risk-initiation';
import { ChangeDetectionStrategy, Component, OnInit, computed, inject, signal } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { FormsModule } from '@angular/forms';
import { firstValueFrom } from 'rxjs';
import { I18nService } from '../../../core/i18n.service';
import { ToastService } from '../../../shared/toast.service';
import { AppIcon } from '../../../shared/app-icon';
import { StatusChip } from '../../../shared/status-chip';
import { AiRiskAssessment } from './ai-risk-assessment';
import { AiRiskAdoption } from './ai-risk-adoption';
import { AiRiskResponse } from './ai-risk-response';
import { AiTreatment } from './ai-treatment';
import { AiResidualReview } from './ai-residual-review';
import { AiRiskMonitoring } from './ai-risk-monitoring';
import { InputTextModule } from 'primeng/inputtext';
import { SelectModule } from 'primeng/select';
import { TableModule } from 'primeng/table';
import { TextareaModule } from 'primeng/textarea';

interface RiskItem {
  controlPins:ControlTag[]|null;suggestedControlPins:{controlPins:ControlTag[]}|null;
  libraryVersion: {id:string;round:number;entry:{libraryRef:string}}|null;
  id: string; riskRef: string | null; version: number; title: string | null; cause: string | null; event: string | null; effect: string | null;
  canEdit: boolean; canAssignOwner: boolean; intakeData: Record<string, unknown> | null; handoffPayload: Record<string, unknown> | null;
  owner: { userId: string; fullNameEn: string; fullNameAr: string } | null;
  useCase: { useCaseRef: string; name: string; operationalStatusCode: string | null; asset: { code: string; nameEn: string; nameAr: string }; organizationUnit: { nameEn: string; nameAr: string } };
  obligations: Array<{ id: string; description: string }>;
  workflowCase: { id: string; code: string; status: string };
}
interface RiskLookups {
  ready: boolean;
  lists: Array<{ field: string; values: Array<{ code: string; labelEn: string; labelAr: string }> }>;
  riskOwners: Array<{ userId: string; fullNameEn: string; fullNameAr: string }>;
}

@Component({ selector: 'app-ai-risks', standalone: true, imports: [AiAuditQuery, AiSeverity, AiJourneyHistory, AiControlPicker,AiRiskInitiation, FormsModule, AppIcon, StatusChip, AiRiskAssessment, AiRiskAdoption, AiRiskResponse, AiRiskStrategy, AiTreatment, AiResidualReview, AiRiskMonitoring, InputTextModule, SelectModule, TableModule, TextareaModule],
  templateUrl: './ai-risks.html', styleUrls: ['../ai-review/ai-review.scss', './ai-risks.scss'], changeDetection: ChangeDetectionStrategy.OnPush })
export class AiRisksPage implements OnInit {
  private readonly http = inject(HttpClient);
  protected readonly i18n = inject(I18nService);
  private readonly toast = inject(ToastService);
  protected readonly state = signal<'loading' | 'ok' | 'error'>('loading');
  protected readonly working = signal(false);
  protected readonly items = signal<RiskItem[]>([]);
  protected readonly selected = signal<RiskItem | null>(null);
  protected readonly lookups = signal<RiskLookups>({ ready: false, lists: [], riskOwners: [] });
  protected readonly controls=signal<ControlTag[]>([]);
  protected readonly input = signal<Record<string, unknown>>({});
  protected readonly draftCache = signal<Record<string, { fields: Record<string, unknown>; evidence: string }>>({});
  protected readonly dirty = signal(false);
  protected readonly ownerUserId = signal('');
  protected readonly ownerJustification = signal('');
  protected readonly evidenceText = signal('');
  protected readonly textFields = ['cause', 'event', 'effect', 'current_controls', 'notes'];
  protected readonly otherFields = [
    { field: 'cause', kind: 'textarea', required: true },
    { field: 'event', kind: 'textarea', required: true },
    { field: 'effect', kind: 'textarea', required: true },
    { field: 'current_controls', kind: 'textarea', required: true },
    { field: 'notes', kind: 'textarea', required: false },
    { field: 'third_party_involved', kind: 'boolean', required: true },
    { field: 'control_domain_version_ids', kind: 'controls', required: false },
    { field: 'evidence', kind: 'evidence', required: false },
  ] as const;
  protected readonly detailFields = computed(() => [
    ...this.lookups().lists.filter(list => list.field !== 'risk_category').map(list => ({ field: list.field, kind: 'select', required: true })),
    ...this.otherFields,
  ]);
  ngOnInit(): void { void this.load(); }
  protected t(key: string): string { return this.i18n.t(key); }
  protected label(value: { nameEn: string; nameAr: string } | null): string { return value ? (this.i18n.lang() === 'ar' ? value.nameAr : value.nameEn) : '—'; }
  protected ownerLabel(value: { fullNameEn: string; fullNameAr: string }): string { return this.i18n.lang() === 'ar' ? value.fullNameAr : value.fullNameEn; }
  protected optionLabel(value: { labelEn: string; labelAr: string }): string { return this.i18n.lang() === 'ar' ? value.labelAr : value.labelEn; }
  protected lookup(field: string) { return this.lookups().lists.find(list => list.field === field); }
  protected lookupLabel(field: string, code: unknown): string {
    return this.lookup(field)?.values.find(value => value.code === code)?.[this.i18n.lang() === 'ar' ? 'labelAr' : 'labelEn'] ?? (typeof code === 'string' && code ? code : '—');
  }
  protected displayValue(item: RiskItem, field: string): string {
    const value = item.intakeData?.[field];
    if (field === 'third_party_involved') return this.t(value === true ? 'aiuc.yes' : value === false ? 'aiuc.no' : 'aiRisk.notSet');
    if (field === 'control_domain_version_ids') return item.controlPins?.map(pin => pin.controlCode).join(', ') || '—';
    if (field === 'evidence') return Array.isArray(value) ? value.join(', ') || '—' : '—';
    if (this.lookup(field)) return this.lookupLabel(field, value);
    return typeof value === 'string' && value ? value : '—';
  }
  protected selectedControls():string[]{const v=this.input()['control_domain_version_ids'];return Array.isArray(v)?v:[];}
  protected patch(field: string, value: unknown): void {
    this.input.update(input => ({ ...input, [field]: value }));
    if (this.selected()?.canEdit) this.dirty.set(true);
  }
  protected updateEvidence(value: string): void { this.evidenceText.set(value); if (this.selected()?.canEdit) this.dirty.set(true); }
  protected select(item: RiskItem | null): void {
    const previous = this.selected();
    if (previous?.canEdit && this.dirty()) this.draftCache.update(cache => ({ ...cache, [previous.id]: { fields: this.input(), evidence: this.evidenceText() } }));
    this.selected.set(item); this.ownerUserId.set(item?.owner?.userId ?? ''); this.ownerJustification.set('');
    const stored = item?.intakeData ?? {};
    const initial = Object.fromEntries(['title', ...this.textFields, ...this.lookups().lists.map(list => list.field)].map(field => [field,
      stored[field] ?? (field === 'title' ? item?.title ?? '' : field === 'dev_stage' ? item?.handoffPayload?.['lifecycleStage'] ?? '' : '')]));
    initial['control_domain_version_ids'] = stored['control_domain_version_ids'] ?? [];
    initial['third_party_involved'] = stored['third_party_involved'] ?? item?.handoffPayload?.['thirdPartyInvolved'] ?? false;
    const cached = item ? this.draftCache()[item.id] : null;
    this.input.set(cached?.fields ?? initial);
    this.evidenceText.set(cached?.evidence ?? (Array.isArray(stored['evidence']) ? stored['evidence'].join('\n') : ''));
    this.dirty.set(!!cached);
  }
  protected async load(preferredId?: string): Promise<void> {
    this.state.set('loading');
    try {
      const [items, lookups] = await Promise.all([firstValueFrom(this.http.get<RiskItem[]>('/api/ai/risks')),
        firstValueFrom(this.http.get<RiskLookups>('/api/ai/risks/lookups'))]);
      if(preferredId&&!items.some(i=>i.id===preferredId))items.unshift(await firstValueFrom(this.http.get<RiskItem>(`/api/ai/risks/${preferredId}`)));
      this.controls.set((await firstValueFrom(this.http.get<{rows:ControlTag[]}>('/api/ai/control-domains'))).rows);
      this.items.set(items); this.lookups.set(lookups); this.select(items.find(item => item.id === preferredId) ?? items[0] ?? null); this.state.set('ok');
    } catch (error) { this.state.set('error'); this.toast.errorFrom(error, this.t('aiRisk.error')); }
  }
  protected async assignOwner(): Promise<void> {
    const item = this.selected();
    if (!item?.canAssignOwner || !this.ownerUserId() || !this.ownerJustification().trim() || this.working()) return;
    this.working.set(true);
    try { await firstValueFrom(this.http.post(`/api/ai/risks/${item.id}/owner`, {
      expectedVersion: item.version, ownerUserId: this.ownerUserId(), justification: this.ownerJustification().trim() }));
      this.toast.success(this.t('aiRisk.ownerSaved')); await this.load(item.id);
    } catch (error) { this.toast.errorFrom(error, this.t('aiRisk.error')); } finally { this.working.set(false); }
  }
  protected async save(submit = false): Promise<void> {
    const item = this.selected();
    if (!item?.canEdit || this.working()) return;
    this.working.set(true);
    try {
      const input = { ...this.input(), evidence: [...new Set(this.evidenceText().split(/[\s,;]+/u).filter(Boolean))] };
      const saved = await firstValueFrom(this.http.patch<{ version: number }>(`/api/ai/risks/${item.id}/intake`, { expectedVersion: item.version, input }));
      if (submit) await firstValueFrom(this.http.post(`/api/ai/risks/${item.id}/submit`, { expectedVersion: saved.version }));
      this.dirty.set(false);
      this.draftCache.update(cache => { const next = { ...cache }; delete next[item.id]; return next; });
      this.toast.success(this.t(submit ? 'aiRisk.submitted' : 'aiRisk.saved')); await this.load(item.id);
    } catch (error) {
      this.dirty.set(true);
      this.toast.errorFrom(error, this.t('aiRisk.error'));
      // A valid draft save can precede a failed submission; refresh its version before retry.
      await this.load(item.id);
    } finally { this.working.set(false); }
  }
}
