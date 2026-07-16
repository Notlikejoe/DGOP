import { ChangeDetectionStrategy, Component, OnInit, inject, signal } from '@angular/core';
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
  mdmMatches: any[];
  referenceVersions: any[];
  certifications: any[];
  architectureReviews: any[];
}

@Component({
  selector: 'app-extended-domains',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule, AppIcon, StatusChip],
  templateUrl: './extended-domains.html',
  styleUrl: './extended-domains.scss',
})
export class ExtendedDomainsPage implements OnInit {
  private readonly http = inject(HttpClient);
  protected readonly i18n = inject(I18nService);

  protected readonly state = signal<'loading' | 'ready' | 'error'>('loading');
  protected readonly saving = signal(false);
  protected readonly workspace = signal<Workspace | null>(null);
  protected readonly assets = signal<AssetRef[]>([]);
  protected readonly domains = signal<Ref[]>([]);

  protected matchForm = { sourceAssetId: '', candidateAssetId: '', matchScore: 85 };
  protected referenceForm = { code: '', name: '', version: 'v1', domainId: '', assetId: '', changeSummary: '' };
  protected certForm = {
    assetId: '',
    qualityScore: 80,
    completenessScore: 80,
    ownerConfirmed: true,
    glossaryAligned: true,
    lineageReviewed: true,
  };
  protected archForm = { assetId: '', title: '', riskLevel: 'medium', architectureDecision: '', lineageImpact: '' };

  ngOnInit(): void {
    this.loadRefs();
    this.loadWorkspace();
  }

  protected loadWorkspace(): void {
    this.state.set('loading');
    this.http.get<Workspace>('/api/extended-domains/workspace').subscribe({
      next: (workspace) => {
        this.workspace.set(workspace);
        this.state.set('ready');
      },
      error: () => this.state.set('error'),
    });
  }

  protected createMatch(): void {
    if (!this.matchForm.sourceAssetId || !this.matchForm.candidateAssetId) return;
    this.save('/api/extended-domains/mdm/matches', this.matchForm, () => {
      this.matchForm = { sourceAssetId: '', candidateAssetId: '', matchScore: 85 };
    });
  }

  protected resolveMatch(match: any, status: string): void {
    this.patch(`/api/extended-domains/mdm/matches/${match.id}`, {
      status,
      resolutionStep: status === 'merged' ? 'publish' : 'approval',
      resolutionNote: status === 'merged' ? 'Golden record decision recorded.' : 'Candidate rejected after review.',
    });
  }

  protected createReference(): void {
    if (!this.referenceForm.code || !this.referenceForm.name || !this.referenceForm.version) return;
    this.save('/api/extended-domains/reference/versions', {
      ...this.referenceForm,
      domainId: this.referenceForm.domainId || undefined,
      assetId: this.referenceForm.assetId || undefined,
    }, () => {
      this.referenceForm = { code: '', name: '', version: 'v1', domainId: '', assetId: '', changeSummary: '' };
    });
  }

  protected decideReference(row: any, decision: string): void {
    this.patch(`/api/extended-domains/reference/versions/${row.id}/decision`, { decision });
  }

  protected createCertification(): void {
    if (!this.certForm.assetId) return;
    this.save('/api/extended-domains/metadata/certifications', this.certForm);
  }

  protected certify(row: any): void {
    this.patch(`/api/extended-domains/metadata/certifications/${row.id}`, {
      qualityScore: Math.max(row.qualityScore ?? 0, 85),
      completenessScore: Math.max(row.completenessScore ?? 0, 85),
      ownerConfirmed: true,
      glossaryAligned: true,
      lineageReviewed: true,
      status: 'certified',
    });
  }

  protected createArchitectureReview(): void {
    if (!this.archForm.assetId || !this.archForm.title) return;
    this.save('/api/extended-domains/architecture/reviews', this.archForm, () => {
      this.archForm = { assetId: '', title: '', riskLevel: 'medium', architectureDecision: '', lineageImpact: '' };
    });
  }

  protected decideArchitecture(row: any, decision: string): void {
    this.patch(`/api/extended-domains/architecture/reviews/${row.id}/decision`, { decision });
  }

  protected statusKind(status: string): StatusKind {
    if (['active', 'approved', 'certified', 'merged'].includes(status)) return 'success';
    if (['rejected', 'needs_remediation'].includes(status)) return 'danger';
    if (['under_review', 'pending', 'candidate'].includes(status)) return 'warning';
    return 'info';
  }

  protected t(key: string): string {
    return this.i18n.t(key);
  }

  private loadRefs(): void {
    this.http.get<AssetRef[]>('/api/assets').subscribe({ next: (assets) => this.assets.set(assets), error: () => this.assets.set([]) });
    this.http.get<Ref[]>('/api/data-domains').subscribe({ next: (domains) => this.domains.set(domains), error: () => this.domains.set([]) });
  }

  private save(url: string, body: unknown, reset?: () => void): void {
    this.saving.set(true);
    this.http.post(url, body).subscribe({
      next: () => {
        reset?.();
        this.saving.set(false);
        this.loadWorkspace();
      },
      error: () => this.saving.set(false),
    });
  }

  private patch(url: string, body: unknown): void {
    this.saving.set(true);
    this.http.patch(url, body).subscribe({
      next: () => {
        this.saving.set(false);
        this.loadWorkspace();
      },
      error: () => this.saving.set(false),
    });
  }
}
