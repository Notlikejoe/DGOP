import { RegisterControls } from '../../../shared/register-controls';
import { Subscription } from 'rxjs';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { OnDestroy } from '@angular/core';
interface Paged<T> {
  data: T[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}
type RegisterKey =
  | 'matches'
  | 'goldenRecords'
  | 'references'
  | 'certifications'
  | 'architecture';
const REGISTER_FIELDS = {
  matches: 'mdmMatches',
  goldenRecords: 'goldenRecords',
  references: 'referenceVersions',
  certifications: 'certifications',
  architecture: 'architectureReviews',
} as const;
import { AuthService } from '../../../core/auth.service';
import { ToastService } from '../../../shared/toast.service';
import { ApprovedEvidencePicker } from '../../../shared/approved-evidence-picker';
import {
  ChangeDetectionStrategy,
  Component,
  OnInit,
  inject,
  signal,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { HttpClient } from '@angular/common/http';
import { I18nService } from '../../../core/i18n.service';
import { AppIcon } from '../../../shared/app-icon';
import { StatusChip, StatusKind } from '../../../shared/status-chip';

interface Ref {
  id: string;
  code: string;
  nameEn: string;
  nameAr?: string;
}

interface AssetRef extends Ref {
  domain?: Ref | null;
}

interface Workspace {
  summary: {
    mdmCandidates: number;
    highConfidenceMatches: number;
    referenceVersions: number;
    referencePending: number;
    certifications: number;
    certifiedAssets: number;
    architectureReviews: number;
    architecturePending: number;
  };
  registerPages: Record<RegisterKey, Paged<any>>;
  goldenRecords: any[];
  mdmMatches: any[];
  referenceVersions: any[];
  certifications: any[];
  architectureReviews: any[];
}

interface MdmMatchRunResult {
  threshold: number;
  limit: number;
  evaluatedPairs: number;
  recommendedCount: number;
  createdCount: number;
  skippedExistingCount: number;
  candidates: any[];
  preview?: any[];
}

@Component({
  selector: 'app-extended-domains',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    RegisterControls,
    RouterLink,
    FormsModule,
    AppIcon,
    StatusChip,
    ApprovedEvidencePicker,
  ],
  templateUrl: './extended-domains.html',
  styleUrl: './extended-domains.scss',
})
export class ExtendedDomainsPage implements OnInit, OnDestroy {
  private readonly http = inject(HttpClient);
  protected readonly auth = inject(AuthService);
  private readonly toast = inject(ToastService);
  protected readonly proofDrafts: Record<
    string,
    {
      evidenceId: string;
      evidenceJustification: string;
      decisionReason?: string;
    }
  > = {};
  protected proofDraft(row: any) {
    return (
      this.proofDrafts[row.id] ??
      (this.proofDrafts[row.id] = {
        evidenceId: row.evidenceId ?? '',
        evidenceJustification: '',
      })
    );
  }
  protected reviseArchitecture(row: any) {
    this.save(
      '/api/extended-domains/architecture/reviews/' + row.id + '/revisions',
      {},
    );
  }
  protected readonly i18n = inject(I18nService);

  protected readonly state = signal<'loading' | 'ready' | 'error'>('loading');
  protected readonly saving = signal(false);
  protected readonly workspace = signal<Workspace | null>(null);
  protected readonly assets = signal<AssetRef[]>([]);
  protected readonly domains = signal<Ref[]>([]);
  protected readonly matchRunResult = signal<MdmMatchRunResult | null>(null);

  protected matchRunForm = { sourceAssetId: '', threshold: 65, limit: 10 };
  protected matchForm = {
    sourceAssetId: '',
    candidateAssetId: '',
    matchScore: 85,
  };
  protected referenceForm = {
    code: '',
    name: '',
    version: 'v1',
    domainId: '',
    assetId: '',
    changeSummary: '',
  };
  protected certForm = {
    assetId: '',
    qualityScore: 0,
    completenessScore: 0,
    ownerConfirmed: false,
    glossaryAligned: false,
    lineageReviewed: false,
  };
  protected archForm = {
    assetId: '',
    title: '',
    riskLevel: 'medium',
    architectureDecision: '',
    lineageImpact: '',
  };

  private workspaceRequest?: Subscription;
  private readonly referenceRequests: Subscription[] = [];
  protected readonly referencesUnavailable = signal(false);
  private readonly requests: Partial<Record<RegisterKey, Subscription>> = {};
  protected readonly busy = signal<Partial<Record<RegisterKey, boolean>>>({});
  protected readonly registerErrors = signal<
    Partial<Record<RegisterKey, boolean>>
  >({});
  protected readonly queries: Record<
    RegisterKey,
    { page: number; search: string }
  > = Object.fromEntries(
    [
      'matches',
      'goldenRecords',
      'references',
      'certifications',
      'architecture',
    ].map((key) => [key, { page: 1, search: '' }]),
  ) as Record<RegisterKey, { page: number; search: string }>;
  private generation = 0;
  protected readonly route = inject(ActivatedRoute, { optional: true });

  ngOnInit(): void {
    const search = this.route?.snapshot.queryParamMap.get('architectureSearch');
    if (search)
      this.queries.architecture = { page: 1, search: search.slice(0, 200) };
    this.loadRefs();
    this.loadWorkspace();
  }
  ngOnDestroy(): void {
    ++this.generation;
    this.workspaceRequest?.unsubscribe();
    this.referenceRequests.forEach((request) => request.unsubscribe());
    Object.values(this.requests).forEach((request) => request?.unsubscribe());
  }
  protected loadWorkspace(): void {
    const generation = ++this.generation;
    this.workspaceRequest?.unsubscribe();
    Object.values(this.requests).forEach((request) => request?.unsubscribe());
    if (!this.workspace()) this.state.set('loading');
    this.workspaceRequest = this.http
      .get<Workspace>('/api/extended-domains/workspace')
      .subscribe({
        next: (workspace) => {
          if (generation !== this.generation) return;
          const loaded = {
            ...workspace,
            registerPages: { ...workspace.registerPages },
          };
          for (const key of Object.keys(this.queries) as RegisterKey[])
            if (this.queries[key].page !== 1 || this.queries[key].search) {
              loaded[REGISTER_FIELDS[key]] = [];
              loaded.registerPages[key] = {
                ...loaded.registerPages[key],
                data: [],
                total: 0,
              };
            }
          this.workspace.set(loaded);
          this.saving.set(false);
          this.state.set('ready');
          for (const key of Object.keys(this.queries) as RegisterKey[])
            if (this.queries[key].page !== 1 || this.queries[key].search)
              this.loadRegister(key, this.queries[key]);
        },
        error: (error) => {
          if (generation !== this.generation) return;
          this.state.set('error');
          this.saving.set(false);
          this.toast.errorFrom(error);
        },
      });
  }
  protected loadRegister(
    key: RegisterKey,
    query: { page: number; search: string },
  ): void {
    const generation = this.generation;
    this.requests[key]?.unsubscribe();
    this.queries[key] = { ...query };
    this.workspace.update((workspace) =>
      workspace ? { ...workspace, [REGISTER_FIELDS[key]]: [] } : workspace,
    );
    this.busy.update((state) => ({ ...state, [key]: true }));
    this.registerErrors.update((state) => ({ ...state, [key]: false }));
    this.requests[key] = this.http
      .get<Paged<any>>('/api/extended-domains/registers/' + key, {
        params: { page: query.page, pageSize: 25, search: query.search },
      })
      .subscribe({
        next: (page) => {
          if (generation !== this.generation) return;
          this.workspace.update((workspace) =>
            workspace
              ? {
                  ...workspace,
                  [REGISTER_FIELDS[key]]: page.data,
                  registerPages: { ...workspace.registerPages, [key]: page },
                }
              : workspace,
          );
          this.busy.update((state) => ({ ...state, [key]: false }));
        },
        error: (error) => {
          if (generation !== this.generation) return;
          this.busy.update((state) => ({ ...state, [key]: false }));
          this.registerErrors.update((state) => ({ ...state, [key]: true }));
          this.toast.errorFrom(error);
        },
      });
  }
  protected goldenFields(row: any): { name: string; value: string }[] {
    return Object.entries(row.masteredRecordJson ?? {}).map(
      ([name, value]) => ({
        name: name.replace(/([a-z])([A-Z])/g, '$1 $2'),
        value:
          typeof value === 'object'
            ? JSON.stringify(value)
            : String(value ?? ''),
      }),
    );
  }

  protected createMatch(): void {
    if (!this.matchForm.sourceAssetId || !this.matchForm.candidateAssetId)
      return;
    this.save('/api/extended-domains/mdm/matches', this.matchForm, () => {
      this.matchForm = {
        sourceAssetId: '',
        candidateAssetId: '',
        matchScore: 85,
      };
    });
  }

  protected runMdmMatching(): void {
    if (!this.matchRunForm.sourceAssetId) return;
    this.saving.set(true);
    this.http
      .post<MdmMatchRunResult>('/api/extended-domains/mdm/matches/run', {
        sourceAssetId: this.matchRunForm.sourceAssetId,
        threshold: Number(this.matchRunForm.threshold),
        limit: Number(this.matchRunForm.limit),
      })
      .subscribe({
        next: (result) => {
          this.matchRunResult.set(result);
          this.loadWorkspace();
        },
        error: (error) => {
          this.saving.set(false);
          this.toast.errorFrom(error);
        },
      });
  }

  protected resolveMatch(match: any, status: string): void {
    this.patch(`/api/extended-domains/mdm/matches/${match.id}`, {
      status,
      resolutionStep: status === 'merged' ? 'publish' : 'approval',
      resolutionNote:
        status === 'merged'
          ? 'Golden record decision recorded.'
          : 'Candidate rejected after review.',
    });
  }

  protected createReference(): void {
    if (
      !this.referenceForm.code ||
      !this.referenceForm.name ||
      !this.referenceForm.version
    )
      return;
    this.save(
      '/api/extended-domains/reference/versions',
      {
        ...this.referenceForm,
        domainId: this.referenceForm.domainId || undefined,
        assetId: this.referenceForm.assetId || undefined,
      },
      () => {
        this.referenceForm = {
          code: '',
          name: '',
          version: 'v1',
          domainId: '',
          assetId: '',
          changeSummary: '',
        };
      },
    );
  }

  protected decideReference(row: any, decision: string): void {
    this.patch(`/api/extended-domains/reference/versions/${row.id}/decision`, {
      decision,
    });
  }

  protected createCertification(): void {
    if (!this.certForm.assetId) return;
    this.save('/api/extended-domains/metadata/certifications', this.certForm);
  }

  protected certify(row: any): void {
    this.patch(`/api/extended-domains/metadata/certifications/${row.id}`, {
      qualityScore: row.qualityScore,
      completenessScore: row.completenessScore,
      ownerConfirmed: true,
      glossaryAligned: true,
      lineageReviewed: true,
      status: 'certified',
    });
  }

  protected createArchitectureReview(): void {
    if (!this.archForm.assetId || !this.archForm.title) return;
    this.save(
      '/api/extended-domains/architecture/reviews',
      this.archForm,
      () => {
        this.archForm = {
          assetId: '',
          title: '',
          riskLevel: 'medium',
          architectureDecision: '',
          lineageImpact: '',
        };
      },
    );
  }

  protected decideArchitecture(row: any, decision: string): void {
    this.patch(
      `/api/extended-domains/architecture/reviews/${row.id}/decision`,
      {
        decision,
        expectedVersion: row.version,
        workflowTaskId: row.workflowTaskId,
        ...this.proofDraft(row),
        decisionReason:
          this.proofDraft(row).decisionReason?.trim() || undefined,
      },
    );
  }

  protected statusKind(status: string): StatusKind {
    if (['active', 'approved', 'certified', 'merged'].includes(status))
      return 'success';
    if (['rejected', 'needs_remediation'].includes(status)) return 'danger';
    if (['under_review', 'pending', 'candidate'].includes(status))
      return 'warning';
    return 'info';
  }

  protected topMdmFactors(row: any): any[] {
    const factors = row?.survivorshipRulesJson?.factors;
    return Array.isArray(factors)
      ? factors.filter((factor) => Number(factor?.score ?? 0) >= 60).slice(0, 3)
      : [];
  }

  protected t(key: string): string {
    return this.i18n.t(key);
  }

  private loadRefs(): void {
    if (!this.auth.hasPermission('extended_domains.create')) return;
    if (this.auth.hasPermission('data_assets.view'))
      this.referenceRequests.push(
        this.http.get<AssetRef[]>('/api/assets').subscribe({
          next: (rows) => this.assets.set(rows),
          error: () => {
            this.assets.set([]);
            this.referencesUnavailable.set(true);
          },
        }),
      );
    else this.referencesUnavailable.set(true);
    if (this.auth.hasPermission('data_domains.view'))
      this.referenceRequests.push(
        this.http.get<Ref[]>('/api/data-domains').subscribe({
          next: (rows) => this.domains.set(rows),
          error: () => {
            this.domains.set([]);
            this.referencesUnavailable.set(true);
          },
        }),
      );
    else this.referencesUnavailable.set(true);
  }

  private save(url: string, body: unknown, reset?: () => void): void {
    this.saving.set(true);
    this.http.post(url, body).subscribe({
      next: () => {
        reset?.();
        this.loadWorkspace();
      },
      error: (error) => {
        this.saving.set(false);
        this.toast.errorFrom(error);
      },
    });
  }

  private patch(url: string, body: unknown): void {
    this.saving.set(true);
    this.http.patch(url, body).subscribe({
      next: () => {
        this.loadWorkspace();
      },
      error: (error) => {
        this.saving.set(false);
        this.toast.errorFrom(error);
      },
    });
  }
}
