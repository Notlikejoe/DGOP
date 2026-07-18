import { ChangeDetectionStrategy, Component, OnInit, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { HttpClient } from '@angular/common/http';
import { RouterLink } from '@angular/router';
import { I18nService } from '../../../core/i18n.service';
import { ErrorExperienceService, UserFacingError } from '../../../core/error-experience.service';
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

interface OperatingModel {
  status: string;
  summary: {
    governedAssets: number;
    assignedAssets: number;
    dataDomains: number;
    systemPlatforms: number;
    activeCases: number;
    openTasks: number;
    overdueTasks: number;
  };
  bodies: Array<{
    code: string;
    name: string;
    purpose: string;
    cadence: string;
    status: string;
    operatingPressure: number;
  }>;
  kpiTraceability: Array<{
    code: string;
    label: string;
    formula: string;
    ownerRoleCode: string;
    value: number;
    unit: string;
    status: string;
  }>;
  dgpoSizing: {
    recommendedFte: number;
    bands: Record<string, number>;
  };
}

interface PlatformArchitecture {
  status: string;
  summary: {
    services: number;
    ready: number;
    watch: number;
    blocked: number;
    boundedContexts: number;
    openRisks: number;
  };
  services: Array<{
    code: string;
    name: string;
    boundedContext: string;
    serviceType: string;
    ownerRoleCode: string;
    dependencies: string[];
    acceptanceSignals: string[];
    route: string;
    status: string;
    signals: {
      dataSignals: number;
      openRisks: number;
      wiredDependencies: number;
      requiredDependencies: number;
    };
  }>;
  boundedContexts: Array<{
    code: string;
    services: number;
    status: string;
  }>;
  dependencyMap: Array<{
    from: string;
    to: string;
    status: string;
  }>;
}

interface ControlCrosswalk {
  status: string;
  summary: {
    controls: number;
    ready: number;
    watch: number;
    blocked: number;
    acceptedDeferrals: number;
    openRisks: number;
  };
  controls: Array<{
    code: string;
    name: string;
    family: string;
    ownerRoleCode: string;
    frameworks: string[];
    implementation: string;
    acceptedDeferral?: string;
    status: string;
    signals: { evidenceSignals: number; openRisks: number; acceptedDeferral?: boolean };
  }>;
  frameworkCoverage: Array<{ framework: string; controls: number; ready: number }>;
}

interface ProductionAcceptance {
  status: string;
  summary: { items: number; ready: number; watch: number; blocked: number };
  items: Array<{
    code: string;
    name: string;
    family: string;
    ownerRoleCode: string;
    target: string;
    evidence: string[];
    status: string;
  }>;
  environments: Array<{ name: string; status: string; entry: string; exit: string }>;
}

interface ErrorExperienceReadiness {
  status: string;
  summary: {
    categories: number;
    ready: number;
    watch: number;
    blocked: number;
    importErrors: number;
    systemSignals: number;
  };
  categories: Array<{
    code: string;
    name: string;
    family: string;
    implementation: string;
    status: string;
    signals: { evidenceSignals: number; openRisks: number };
  }>;
  envelope: { requiredFields: string[]; publicCodes: string[] };
}

@Component({
  selector: 'app-governance-operations',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule, RouterLink, AppIcon, StatusChip],
  templateUrl: './governance-operations.html',
  styleUrl: './governance-operations.scss',
})
export class GovernanceOperationsPage implements OnInit {
  private readonly http = inject(HttpClient);
  protected readonly i18n = inject(I18nService);
  private readonly errors = inject(ErrorExperienceService);

  protected readonly state = signal<'loading' | 'ready' | 'error'>('loading');
  protected readonly busy = signal(false);
  protected readonly workspace = signal<Workspace | null>(null);
  protected readonly operatingModel = signal<OperatingModel | null>(null);
  protected readonly platformArchitecture = signal<PlatformArchitecture | null>(null);
  protected readonly controlCrosswalk = signal<ControlCrosswalk | null>(null);
  protected readonly productionAcceptance = signal<ProductionAcceptance | null>(null);
  protected readonly errorExperience = signal<ErrorExperienceReadiness | null>(null);
  protected readonly pageError = signal<UserFacingError | null>(null);

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
    this.pageError.set(null);
    this.platformArchitecture.set(null);
    this.controlCrosswalk.set(null);
    this.productionAcceptance.set(null);
    this.errorExperience.set(null);
    this.http.get<Workspace>('/api/governance-operations/workspace').subscribe({
      next: (workspace) => {
        this.workspace.set(workspace);
        this.state.set('ready');
      },
      error: (error) => {
        this.pageError.set(this.errors.interpret(error));
        this.state.set('error');
      },
    });
    this.http.get<OperatingModel>('/api/governance-operations/operating-model').subscribe({
      next: (model) => this.operatingModel.set(model),
      error: () => this.operatingModel.set(null),
    });
    this.http.get<PlatformArchitecture>('/api/governance-operations/platform-architecture').subscribe({
      next: (architecture) => this.platformArchitecture.set(architecture),
      error: () => this.platformArchitecture.set(null),
    });
    this.http.get<ControlCrosswalk>('/api/governance-operations/control-crosswalk').subscribe({
      next: (crosswalk) => this.controlCrosswalk.set(crosswalk),
      error: () => this.controlCrosswalk.set(null),
    });
    this.http.get<ProductionAcceptance>('/api/governance-operations/production-acceptance').subscribe({
      next: (acceptance) => this.productionAcceptance.set(acceptance),
      error: () => this.productionAcceptance.set(null),
    });
    this.http.get<ErrorExperienceReadiness>('/api/governance-operations/error-experience').subscribe({
      next: (readiness) => this.errorExperience.set(readiness),
      error: () => this.errorExperience.set(null),
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
    if (['healthy', 'success', 'done', 'completed', 'resolved', 'read', 'ready'].includes(status)) return 'success';
    if (['critical', 'overdue', 'cancelled', 'blocked'].includes(status)) return 'danger';
    if (['warning', 'review', 'at_risk', 'open', 'acknowledged', 'unread', 'active', 'watch'].includes(status)) return 'warning';
    return 'info';
  }

  protected evidenceText(values?: string[] | null): string {
    return values?.length ? values.join(', ') : '-';
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
