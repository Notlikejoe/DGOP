import { ChangeDetectionStrategy, Component, OnInit, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { HttpClient } from '@angular/common/http';
import { I18nService } from '../../../core/i18n.service';
import { AppIcon } from '../../../shared/app-icon';
import { StatusChip, StatusKind } from '../../../shared/status-chip';

interface GraphNode {
  id: string;
  type: string;
  label: string;
  sublabel?: string;
  status: string;
  count: number;
  x: number;
  y: number;
}

interface GraphEdge {
  id: string;
  from: string;
  to: string;
  label: string;
  tone: string;
}

interface Workspace {
  summary: {
    openTasks: number;
    atRiskTasks: number;
    overdueTasks: number;
    unreadNotifications: number;
    activeEscalations: number;
    calendarItems: number;
    holidaysConfigured: number;
  };
  taskSignals: any[];
  notifications: any[];
  escalations: any[];
  templates: any[];
  occurrences: any[];
  holidays: any[];
  graph: { nodes: GraphNode[]; edges: GraphEdge[] };
}

@Component({
  selector: 'app-governance-operations',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule, AppIcon, StatusChip],
  templateUrl: './governance-operations.html',
  styleUrl: './governance-operations.scss',
})
export class GovernanceOperationsPage implements OnInit {
  private readonly http = inject(HttpClient);
  protected readonly i18n = inject(I18nService);

  protected readonly state = signal<'loading' | 'ready' | 'error'>('loading');
  protected readonly busy = signal(false);
  protected readonly workspace = signal<Workspace | null>(null);

  protected holidayForm = { date: '', nameEn: '', isRecurring: false };
  protected templateForm = {
    title: '',
    type: 'monthly_dq_scorecard_review',
    cadence: 'monthly',
    ownerRoleCode: 'dq_steward',
    nextRunAt: '',
    defaultSlaBusinessDays: 5,
  };

  protected readonly nodeMap = computed(() => {
    const map = new Map<string, GraphNode>();
    for (const node of this.workspace()?.graph.nodes ?? []) map.set(node.id, node);
    return map;
  });

  ngOnInit(): void {
    this.loadWorkspace();
  }

  protected loadWorkspace(): void {
    this.state.set('loading');
    this.http.get<Workspace>('/api/governance-operations/workspace').subscribe({
      next: (workspace) => {
        this.workspace.set(workspace);
        this.state.set('ready');
      },
      error: () => this.state.set('error'),
    });
  }

  protected recalculate(): void {
    this.run('/api/governance-operations/recalculate-sla');
  }

  protected generateCalendar(): void {
    this.run('/api/governance-operations/calendar/generate');
  }

  protected createHoliday(): void {
    if (!this.holidayForm.date || !this.holidayForm.nameEn) return;
    this.busy.set(true);
    this.http.post('/api/governance-operations/holidays', this.holidayForm).subscribe({
      next: () => {
        this.holidayForm = { date: '', nameEn: '', isRecurring: false };
        this.busy.set(false);
        this.loadWorkspace();
      },
      error: () => this.busy.set(false),
    });
  }

  protected createTemplate(): void {
    if (!this.templateForm.title || !this.templateForm.nextRunAt) return;
    this.busy.set(true);
    this.http.post('/api/governance-operations/calendar/templates', this.templateForm).subscribe({
      next: () => {
        this.templateForm = {
          title: '',
          type: 'monthly_dq_scorecard_review',
          cadence: 'monthly',
          ownerRoleCode: 'dq_steward',
          nextRunAt: '',
          defaultSlaBusinessDays: 5,
        };
        this.busy.set(false);
        this.loadWorkspace();
      },
      error: () => this.busy.set(false),
    });
  }

  protected markRead(row: any): void {
    this.patch(`/api/governance-operations/notifications/${row.id}/read`, {});
  }

  protected updateEscalation(row: any, status: string): void {
    this.patch(`/api/governance-operations/escalations/${row.id}`, { status });
  }

  protected nodeStyle(node: GraphNode): Record<string, string> {
    return { left: `${node.x}%`, top: `${node.y}%` };
  }

  protected edgeLine(edge: GraphEdge): { x1: number; y1: number; x2: number; y2: number } {
    const from = this.nodeMap().get(edge.from);
    const to = this.nodeMap().get(edge.to);
    return {
      x1: from?.x ?? 0,
      y1: from?.y ?? 0,
      x2: to?.x ?? 0,
      y2: to?.y ?? 0,
    };
  }

  protected statusKind(status: string): StatusKind {
    if (['healthy', 'success', 'done', 'completed', 'resolved', 'read'].includes(status)) return 'success';
    if (['critical', 'overdue', 'cancelled'].includes(status)) return 'danger';
    if (['warning', 'review', 'at_risk', 'open', 'acknowledged', 'unread', 'active'].includes(status)) return 'warning';
    return 'info';
  }

  protected shortLevel(level: string): string {
    return level
      .split('_')
      .map((part) => part[0]?.toUpperCase() + part.slice(1))
      .join(' ');
  }

  protected formatDate(value?: string | Date | null): string {
    if (!value) return '-';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return '-';
    return new Intl.DateTimeFormat(this.i18n.lang() === 'ar' ? 'ar-SA' : 'en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    }).format(date);
  }

  protected t(key: string): string {
    return this.i18n.t(key);
  }

  private run(url: string): void {
    this.busy.set(true);
    this.http.post<{ workspace?: Workspace }>(url, {}).subscribe({
      next: (result) => {
        if (result.workspace) this.workspace.set(result.workspace);
        this.busy.set(false);
        if (!result.workspace) this.loadWorkspace();
      },
      error: () => this.busy.set(false),
    });
  }

  private patch(url: string, body: unknown): void {
    this.busy.set(true);
    this.http.patch(url, body).subscribe({
      next: () => {
        this.busy.set(false);
        this.loadWorkspace();
      },
      error: () => this.busy.set(false),
    });
  }
}
