import { ChangeDetectionStrategy, Component, OnInit, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { HttpClient, HttpResponse } from '@angular/common/http';
import { I18nService } from '../../../core/i18n.service';
import { AppIcon } from '../../../shared/app-icon';
import { StatusChip, StatusKind } from '../../../shared/status-chip';

interface NdiDomain {
  id: string;
  code: string;
  shortCode?: string | null;
  nameEn: string;
  nameAr: string;
}

interface AuditPack {
  id: string;
  code: string;
  scopeType: string;
  status: string;
  readinessScore: number;
  specCount: number;
  approvedEvidenceCount: number;
  gapCount: number;
  blockerCount: number;
  fileSha256?: string | null;
  generatedAt?: string | null;
  requestedBy: string;
  domain?: NdiDomain | null;
}

interface ReadinessPreview {
  summary: {
    status: string;
    readinessScore: number;
    specCount: number;
    approvedEvidenceCount: number;
    gapCount: number;
    blockerCount: number;
    frameworks: string[];
  };
  manifest: {
    files: { path: string; sha256: string; bytes: number }[];
    evidence: { id: string; specCode: string; originalName: string; sha256: string }[];
  };
}

@Component({
  selector: 'app-audit-packs',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule, AppIcon, StatusChip],
  templateUrl: './audit-packs.html',
  styleUrl: './audit-packs.scss',
})
export class AuditPacksPage implements OnInit {
  private readonly http = inject(HttpClient);
  protected readonly i18n = inject(I18nService);

  protected readonly state = signal<'loading' | 'ready' | 'error'>('loading');
  protected readonly generating = signal(false);
  protected readonly domains = signal<NdiDomain[]>([]);
  protected readonly packs = signal<AuditPack[]>([]);
  protected readonly selectedDomainId = signal('');
  protected readonly preview = signal<ReadinessPreview | null>(null);

  protected readonly latest = computed(() => this.packs()[0] ?? null);

  ngOnInit(): void {
    this.load();
  }

  protected load(): void {
    this.state.set('loading');
    this.http.get<NdiDomain[]>('/api/ndi/domains').subscribe({
      next: (domains) => {
        this.domains.set(domains);
        this.loadPacks();
        this.refreshPreview();
      },
      error: () => this.state.set('error'),
    });
  }

  protected loadPacks(): void {
    this.http.get<AuditPack[]>('/api/ndi/audit-packs').subscribe({
      next: (packs) => {
        this.packs.set(packs);
        this.state.set('ready');
      },
      error: () => this.state.set('error'),
    });
  }

  protected refreshPreview(): void {
    const domainId = this.selectedDomainId() || undefined;
    this.http.post<ReadinessPreview>('/api/ndi/audit-packs/readiness', { domainId }).subscribe({
      next: (preview) => this.preview.set(preview),
      error: () => this.preview.set(null),
    });
  }

  protected setDomain(value: string): void {
    this.selectedDomainId.set(value);
    this.refreshPreview();
  }

  protected generate(): void {
    this.generating.set(true);
    this.http.post<AuditPack>('/api/ndi/audit-packs', { domainId: this.selectedDomainId() || undefined }).subscribe({
      next: () => {
        this.generating.set(false);
        this.loadPacks();
        this.refreshPreview();
      },
      error: () => this.generating.set(false),
    });
  }

  protected download(pack: AuditPack): void {
    this.http
      .get(`/api/ndi/audit-packs/${pack.id}/export`, { responseType: 'blob', observe: 'response' })
      .subscribe((response: HttpResponse<Blob>) => {
        const blob = response.body;
        if (!blob) return;
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = this.fileName(response, `${pack.code}.zip`);
        link.click();
        URL.revokeObjectURL(url);
      });
  }

  protected statusKind(status: string): StatusKind {
    if (status === 'generated' || status === 'ready') return 'success';
    if (status === 'failed' || status === 'blocked') return 'danger';
    if (status === 'watch') return 'warning';
    return 'info';
  }

  protected shortHash(value?: string | null): string {
    return value ? value.slice(0, 12) : '-';
  }

  protected t(key: string): string {
    return this.i18n.t(key);
  }

  private fileName(response: HttpResponse<Blob>, fallback: string): string {
    const header = response.headers.get('content-disposition') ?? '';
    const match = header.match(/filename="([^"]+)"/);
    return match?.[1] ?? fallback;
  }
}
