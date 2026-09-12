import { ChangeDetectionStrategy, Component, OnInit, inject, signal } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { FormsModule } from '@angular/forms';
import { firstValueFrom } from 'rxjs';
import { I18nService } from '../../../core/i18n.service';
import { ToastService } from '../../../shared/toast.service';
import { AppIcon } from '../../../shared/app-icon';
import { StatusChip } from '../../../shared/status-chip';

interface RiskItem {
  id: string; riskRef: string | null; version: number; title: string | null; cause: string | null; event: string | null; effect: string | null;
  canEdit: boolean; canAssignOwner: boolean; intakeData: Record<string, unknown> | null; handoffPayload: Record<string, unknown> | null;
  owner: { userId: string; fullNameEn: string; fullNameAr: string } | null;
  useCase: { useCaseRef: string; name: string; asset: { code: string; nameEn: string; nameAr: string }; organizationUnit: { nameEn: string; nameAr: string } };
  obligations: Array<{ id: string; description: string }>;
  workflowCase: { id: string; code: string; status: string };
}
interface RiskLookups {
  ready: boolean;
  lists: Array<{ field: string; values: Array<{ code: string; labelEn: string; labelAr: string }> }>;
  riskOwners: Array<{ userId: string; fullNameEn: string; fullNameAr: string }>;
}

@Component({ selector: 'app-ai-risks', standalone: true, imports: [FormsModule, AppIcon, StatusChip],
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
  protected readonly input = signal<Record<string, unknown>>({});
  protected readonly ownerUserId = signal('');
  protected readonly ownerJustification = signal('');
  protected readonly evidenceText = signal('');
  protected readonly textFields = ['cause', 'event', 'effect', 'current_controls', 'notes'];
  ngOnInit(): void { void this.load(); }
  protected t(key: string): string { return this.i18n.t(key); }
  protected label(value: { nameEn: string; nameAr: string } | null): string { return value ? (this.i18n.lang() === 'ar' ? value.nameAr : value.nameEn) : '—'; }
  protected ownerLabel(value: { fullNameEn: string; fullNameAr: string }): string { return this.i18n.lang() === 'ar' ? value.fullNameAr : value.fullNameEn; }
  protected optionLabel(value: { labelEn: string; labelAr: string }): string { return this.i18n.lang() === 'ar' ? value.labelAr : value.labelEn; }
  protected patch(field: string, value: unknown): void { this.input.update(input => ({ ...input, [field]: value })); }
  protected select(item: RiskItem | null): void {
    this.selected.set(item); this.ownerUserId.set(item?.owner?.userId ?? ''); this.ownerJustification.set('');
    const stored = item?.intakeData ?? {};
    this.input.set(Object.fromEntries(['title', ...this.textFields, ...this.lookups().lists.map(list => list.field)].map(field => [field,
      stored[field] ?? (field === 'title' ? item?.title ?? '' : field === 'dev_stage' ? item?.handoffPayload?.['lifecycleStage'] ?? '' : '')])));
    this.patch('third_party_involved', stored['third_party_involved'] ?? item?.handoffPayload?.['thirdPartyInvolved'] ?? false);
    this.evidenceText.set(Array.isArray(stored['evidence']) ? stored['evidence'].join('\n') : '');
  }
  protected async load(preferredId?: string): Promise<void> {
    this.state.set('loading');
    try {
      const [items, lookups] = await Promise.all([firstValueFrom(this.http.get<RiskItem[]>('/api/ai/risks')),
        firstValueFrom(this.http.get<RiskLookups>('/api/ai/risks/lookups'))]);
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
      this.toast.success(this.t(submit ? 'aiRisk.submitted' : 'aiRisk.saved')); await this.load(item.id);
    } catch (error) {
      this.toast.errorFrom(error, this.t('aiRisk.error'));
      // A valid draft save can precede a failed submission; refresh its version before retry.
      await this.load(item.id);
    } finally { this.working.set(false); }
  }
}
