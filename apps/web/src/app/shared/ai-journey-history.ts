import { ChangeDetectionStrategy, Component, inject, input, OnInit, signal } from '@angular/core';
import { DatePipe } from '@angular/common';
import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { RouterLink } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import { TableModule, TableLazyLoadEvent } from 'primeng/table';
import { I18nService } from '../core/i18n.service';
import { StatusChip } from './status-chip';

interface Round { id: string; kind: string; round: number; result: Record<string, unknown>; createdAt: string;
  decisions: Array<{ kind: string; decision: string; actorRoleCode: string; justification: string; createdAt: string }> }
interface Journey { id: string; useCaseRef: string; name: string; operationalStatusCode: string | null;
  asset: { id: string; code: string; nameEn: string; nameAr: string } | null;
  workflowCase: { code: string; status: string } | null;
  assessments: Array<{ round: number; result: Record<string, unknown>; createdAt: string }>;
  risks: Array<{ id: string; riskRef: string; title: string; workflowCase: { status: string } | null; assessments: Round[];
    actions: Array<{ actionRef: string; title: string; progress: Array<{ completionPct: number }> }>;
    reviews: Array<{ id: string; dueAt: string; bandCode: string; completion: { completedAt: string } | null; cancellation: unknown }> }> }
interface History { rows: Journey[]; total: number; page: number; pageSize: number; demoMode: boolean; readOnly: boolean }

@Component({ selector: 'app-ai-journey-history', standalone: true,
  imports: [DatePipe, RouterLink, TableModule, StatusChip], changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './ai-journey-history.html', styleUrl: './ai-journey-history.scss' })
export class AiJourneyHistory implements OnInit {
  readonly expanded = input(false);
  private readonly http = inject(HttpClient);
  protected readonly i18n = inject(I18nService);
  protected readonly history = signal<History | null>(null);
  protected readonly state = signal<'loading' | 'ok' | 'error' | 'hidden'>('loading');
  private sequence = 0;
  ngOnInit() { void this.load(); }
  protected t(k: string) { return this.i18n.t(k); }
  protected async load(page = 1, pageSize = 10) {
    const seq = ++this.sequence; this.state.set('loading');
    try {
      const result = await firstValueFrom(this.http.get<History>('/api/ai/history', { params: { page, pageSize } }));
      if (seq !== this.sequence) return;
      this.history.set(result); this.state.set('ok');
    } catch (error) {
      if (seq !== this.sequence) return;
      this.state.set(error instanceof HttpErrorResponse && error.status === 403 ? 'hidden' : 'error');
    }
  }
  protected paginate(event: TableLazyLoadEvent) {
    const size = event.rows ?? 10; void this.load(Math.floor((event.first ?? 0) / size) + 1, size);
  }
  protected value(result: Record<string, unknown>, ...keys: string[]): string {
    for (const key of keys) { const v = result[key]; if (typeof v === 'string' || typeof v === 'number') return String(v); }
    return '—';
  }
  protected latest(rounds: Round[], kind: string): Round | undefined {
    return [...rounds].reverse().find(r => r.kind === kind);
  }
}
