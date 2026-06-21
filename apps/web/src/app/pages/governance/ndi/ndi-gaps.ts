import { ChangeDetectionStrategy, Component, inject, OnInit, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { HttpClient, HttpParams } from '@angular/common/http';
import { I18nService } from '../../../core/i18n.service';
import { StatusChip, StatusKind } from '../../../shared/status-chip';
import { NdiDomainRef } from './ndi.types';
import { GAP_TYPES, GapRow, GapType, SEVERITY_KIND } from './scoring.types';

@Component({
  selector: 'app-ndi-gaps',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule, RouterLink, StatusChip],
  templateUrl: './ndi-gaps.html',
  styleUrl: './ndi.scss',
})
export class NdiGapsPage implements OnInit {
  private readonly http = inject(HttpClient);
  private readonly route = inject(ActivatedRoute);
  protected readonly i18n = inject(I18nService);

  protected readonly state = signal<'loading' | 'ok' | 'error'>('loading');
  protected readonly rows = signal<GapRow[]>([]);
  protected readonly domains = signal<NdiDomainRef[]>([]);
  protected readonly gapTypes = GAP_TYPES;

  protected readonly gapType = signal<string>('');
  protected readonly domainId = signal<string>('');

  ngOnInit(): void {
    const gt = this.route.snapshot.queryParamMap.get('gapType');
    if (gt) this.gapType.set(gt);
    this.http.get<NdiDomainRef[]>('/api/ndi/domains').subscribe((d) => this.domains.set(d));
    this.load();
  }

  protected load(): void {
    this.state.set('loading');
    let params = new HttpParams();
    if (this.gapType()) params = params.set('gapType', this.gapType());
    if (this.domainId()) params = params.set('domainId', this.domainId());
    this.http.get<GapRow[]>('/api/ndi/scoring/gaps', { params }).subscribe({
      next: (r) => {
        this.rows.set(r);
        this.state.set('ok');
      },
      error: () => this.state.set('error'),
    });
  }

  protected setGapType(v: string): void {
    this.gapType.set(v);
    this.load();
  }
  protected setDomain(v: string): void {
    this.domainId.set(v);
    this.load();
  }
  protected reset(): void {
    this.gapType.set('');
    this.domainId.set('');
    this.load();
  }

  protected t(key: string): string {
    return this.i18n.t(key);
  }
  protected name(o: { nameEn: string; nameAr: string }): string {
    return this.i18n.lang() === 'ar' ? o.nameAr : o.nameEn;
  }
  protected gapName(r: GapRow): string {
    return this.i18n.lang() === 'ar' ? r.nameAr : r.nameEn;
  }
  protected severityKind(s: GapRow['severity']): StatusKind {
    return SEVERITY_KIND[s] ?? 'muted';
  }
}
