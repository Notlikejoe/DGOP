import { ChangeDetectionStrategy, Component, computed, inject, OnInit, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { HttpClient, HttpParams } from '@angular/common/http';
import { I18nService } from '../../../core/i18n.service';
import { Pager } from '../../../shared/pager';

interface AuditEntry {
  id: string;
  actor: string;
  action: string;
  entityType: string;
  entityId: string | null;
  metadata: Record<string, unknown> | null;
  createdAt: string;
}

interface Paged<T> {
  data: T[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

interface Filters {
  actor: string;
  action: string;
  entityType: string;
  from: string;
  to: string;
}

@Component({
  selector: 'app-audit-log',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule, Pager],
  templateUrl: './audit-log.html',
  styleUrl: './audit-log.scss',
})
export class AuditLogPage implements OnInit {
  private readonly http = inject(HttpClient);
  protected readonly i18n = inject(I18nService);

  protected readonly state = signal<'loading' | 'ok' | 'error'>('loading');
  protected readonly entries = signal<AuditEntry[]>([]);
  protected readonly actions = signal<string[]>([]);
  protected readonly entityTypes = signal<string[]>([]);

  protected readonly page = signal(1);
  protected readonly pageSize = signal(25);
  protected readonly total = signal(0);
  protected readonly totalPages = signal(1);

  protected readonly filters = signal<Filters>({
    actor: '',
    action: '',
    entityType: '',
    from: '',
    to: '',
  });

  protected readonly activeFilterCount = computed(() =>
    Object.values(this.filters()).filter((value) => !!value).length,
  );

  ngOnInit(): void {
    this.http
      .get<{ entityTypes: string[]; actions: string[] }>('/api/audit/facets')
      .subscribe({
        next: (f) => {
          this.actions.set(f.actions);
          this.entityTypes.set(f.entityTypes);
        },
        error: () => {},
      });
    this.load();
  }

  protected load(): void {
    this.state.set('loading');
    const f = this.filters();
    let params = new HttpParams()
      .set('page', String(this.page()))
      .set('pageSize', String(this.pageSize()));
    if (f.actor) params = params.set('actor', f.actor);
    if (f.action) params = params.set('action', f.action);
    if (f.entityType) params = params.set('entityType', f.entityType);
    if (f.from) params = params.set('from', f.from);
    if (f.to) params = params.set('to', f.to);
    this.http.get<Paged<AuditEntry>>('/api/audit', { params }).subscribe({
      next: (res) => {
        this.entries.set(res.data);
        this.total.set(res.total);
        this.totalPages.set(res.totalPages);
        this.page.set(res.page);
        this.state.set('ok');
      },
      error: () => this.state.set('error'),
    });
  }

  protected setFilter<K extends keyof Filters>(key: K, value: Filters[K]): void {
    this.filters.update((f) => ({ ...f, [key]: value }));
    this.page.set(1);
    this.load();
  }

  protected reset(): void {
    this.filters.set({ actor: '', action: '', entityType: '', from: '', to: '' });
    this.page.set(1);
    this.load();
  }

  protected goToPage(p: number): void {
    this.page.set(p);
    this.load();
  }

  protected formatTime(iso: string): string {
    const d = new Date(iso);
    return Number.isNaN(d.getTime()) ? iso : d.toLocaleString();
  }

  protected formatMeta(meta: Record<string, unknown> | null): string {
    if (!meta || Object.keys(meta).length === 0) return '';
    return Object.entries(meta)
      .map(([k, v]) => `${k}: ${this.stringify(v)}`)
      .join(', ');
  }

  protected actionLabel(action: string): string {
    const key = `audit.action.${this.actionKey(action)}`;
    const translated = this.t(key);
    if (translated !== key) return translated;
    return action
      .split(/[._-]+/)
      .filter(Boolean)
      .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
      .join(' ');
  }

  protected actionTone(action: string): string {
    const normalized = action.toLowerCase();
    if (normalized.includes('fail') || normalized.includes('error') || normalized.includes('delete')) {
      return 'danger';
    }
    if (normalized.includes('logout') || normalized.includes('revoke') || normalized.includes('archive')) {
      return 'warning';
    }
    if (normalized.includes('login') || normalized.includes('create') || normalized.includes('approve')) {
      return 'success';
    }
    if (normalized.includes('update') || normalized.includes('assign') || normalized.includes('change')) {
      return 'info';
    }
    return 'muted';
  }

  protected actionIcon(action: string): string {
    const normalized = action.toLowerCase();
    if (normalized.includes('login')) return 'IN';
    if (normalized.includes('logout')) return 'OUT';
    if (normalized.includes('delete')) return 'DEL';
    if (normalized.includes('create')) return 'NEW';
    if (normalized.includes('update') || normalized.includes('change')) return 'UPD';
    if (normalized.includes('assign')) return 'ASN';
    return 'ACT';
  }

  private stringify(v: unknown): string {
    if (v === null || v === undefined) return '-';
    if (Array.isArray(v)) return v.join(' / ');
    if (typeof v === 'object') return JSON.stringify(v);
    return String(v);
  }

  private actionKey(action: string): string {
    return action.replace(/[^a-zA-Z0-9]+/g, '_').replace(/^_+|_+$/g, '');
  }

  protected t(key: string): string {
    return this.i18n.t(key);
  }
}
