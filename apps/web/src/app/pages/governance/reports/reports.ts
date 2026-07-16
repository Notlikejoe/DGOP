import { ChangeDetectionStrategy, Component, OnInit, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { HttpClient, HttpParams, HttpResponse } from '@angular/common/http';
import { I18nService } from '../../../core/i18n.service';
import { AppIcon } from '../../../shared/app-icon';
import { StatusChip, StatusKind } from '../../../shared/status-chip';

type ReportFormat = 'json' | 'csv' | 'pdf';

interface ReportFilter {
  key: string;
  label: string;
  type: 'date' | 'text' | 'select';
  options?: string[];
}

interface ReportDefinition {
  id: string;
  title: string;
  description: string;
  tower: string;
  supportedFormats: ReportFormat[];
  filters: ReportFilter[];
  scheduledPlaceholder: boolean;
}

interface ReportColumn {
  key: string;
  label: string;
}

interface ReportResult {
  id: string;
  title: string;
  generatedAt: string;
  columns: ReportColumn[];
  rows: Record<string, string | number | boolean | null>[];
  summary: Record<string, string | number | boolean | null>;
}

@Component({
  selector: 'app-reports',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule, AppIcon, StatusChip],
  templateUrl: './reports.html',
  styleUrl: './reports.scss',
})
export class ReportsPage implements OnInit {
  private readonly http = inject(HttpClient);
  protected readonly i18n = inject(I18nService);

  protected readonly state = signal<'loading' | 'ready' | 'error'>('loading');
  protected readonly catalog = signal<ReportDefinition[]>([]);
  protected readonly selectedId = signal('');
  protected readonly result = signal<ReportResult | null>(null);
  protected readonly running = signal(false);
  protected readonly filters = signal<Record<string, string>>({});

  protected readonly selected = computed(() =>
    this.catalog().find((report) => report.id === this.selectedId()) ?? null,
  );

  ngOnInit(): void {
    this.loadCatalog();
  }

  protected loadCatalog(): void {
    this.state.set('loading');
    this.http.get<ReportDefinition[]>('/api/reports').subscribe({
      next: (reports) => {
        this.catalog.set(reports);
        this.selectedId.set(reports[0]?.id ?? '');
        this.state.set('ready');
        if (reports[0]) this.run();
      },
      error: () => this.state.set('error'),
    });
  }

  protected select(report: ReportDefinition): void {
    this.selectedId.set(report.id);
    this.filters.set({});
    this.result.set(null);
    this.run();
  }

  protected setFilter(key: string, value: string): void {
    this.filters.update((current) => ({ ...current, [key]: value }));
  }

  protected run(): void {
    const report = this.selected();
    if (!report) return;
    this.running.set(true);
    this.http.get<ReportResult>(`/api/reports/${report.id}`, { params: this.params() }).subscribe({
      next: (result) => {
        this.result.set(result);
        this.running.set(false);
      },
      error: () => {
        this.result.set(null);
        this.running.set(false);
      },
    });
  }

  protected export(format: ReportFormat): void {
    const report = this.selected();
    if (!report) return;
    this.http
      .get(`/api/reports/${report.id}/export/${format}`, {
        params: this.params(),
        responseType: 'blob',
        observe: 'response',
      })
      .subscribe((response: HttpResponse<Blob>) => {
        const blob = response.body;
        if (!blob) return;
        const fileName = this.fileName(response, `${report.id}.${format}`);
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = fileName;
        link.click();
        URL.revokeObjectURL(url);
      });
  }

  protected t(key: string): string {
    return this.i18n.t(key);
  }

  protected value(row: Record<string, string | number | boolean | null>, key: string): string | number | boolean | null {
    return row[key] ?? '-';
  }

  protected summaryEntries(result: ReportResult): { key: string; value: string | number | boolean | null }[] {
    return Object.entries(result.summary).map(([key, value]) => ({ key, value }));
  }

  protected formatKind(format: string): StatusKind {
    if (format === 'pdf') return 'danger';
    if (format === 'csv') return 'success';
    return 'info';
  }

  private params(): HttpParams {
    let params = new HttpParams();
    for (const [key, value] of Object.entries(this.filters())) {
      if (value) params = params.set(key, value);
    }
    return params;
  }

  private fileName(response: HttpResponse<Blob>, fallback: string): string {
    const header = response.headers.get('content-disposition') ?? '';
    const match = header.match(/filename="([^"]+)"/);
    return match?.[1] ?? fallback;
  }
}
