import { ChangeDetectionStrategy, Component, computed, inject, OnInit, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink, ActivatedRoute } from '@angular/router';
import { HttpClient } from '@angular/common/http';
import { I18nService } from '../../../core/i18n.service';
import { AuthService } from '../../../core/auth.service';
import { ToastService } from '../../../shared/toast.service';
import { Modal } from '../../../shared/modal';
import { StatusChip, StatusKind } from '../../../shared/status-chip';
import {
  APPROVAL_KIND,
  CASE_STATUS_KIND,
  CaseRow,
  SLA_KIND,
  Task,
  UserRef,
  WorkflowDecisionValue,
  WorkflowTokenTrace,
} from './workflow.types';

@Component({
  selector: 'app-workflow-case',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule, RouterLink, Modal, StatusChip],
  templateUrl: './case-detail.html',
  styleUrl: './workflow.scss',
})
export class WorkflowCasePage implements OnInit {
  private readonly http = inject(HttpClient);
  private readonly route = inject(ActivatedRoute);
  protected readonly i18n = inject(I18nService);
  private readonly auth = inject(AuthService);
  private readonly toast = inject(ToastService);

  protected readonly state = signal<'loading' | 'ok' | 'error'>('loading');
  protected readonly wfCase = signal<CaseRow | null>(null);
  protected readonly tokenTrace = signal<WorkflowTokenTrace | null>(null);
  protected readonly tokenTraceState = signal<'idle' | 'loading' | 'ok' | 'error'>('idle');
  protected readonly users = signal<UserRef[]>([]);
  private caseId = '';

  // decision modal
  protected readonly decideTask = signal<Task | null>(null);
  protected readonly decision = signal<WorkflowDecisionValue>('approved');
  protected readonly comment = signal('');
  protected readonly saving = signal(false);
  protected readonly controlAction = signal<'suspend' | 'resume' | 'cancel'>('suspend');
  protected readonly controlReason = signal('');
  protected readonly controlModalOpen = signal(false);

  // add-task modal
  protected readonly taskModalOpen = signal(false);
  protected readonly taskTitle = signal('');
  protected readonly taskAssignee = signal('');
  protected readonly taskDue = signal('');

  ngOnInit(): void {
    this.caseId = this.route.snapshot.paramMap.get('id') ?? '';
    this.load();
    this.http.get<UserRef[]>('/api/users').subscribe({
      next: (u) => this.users.set(u),
      error: () => {},
    });
  }

  protected get canEdit(): boolean { return this.auth.hasPermission('workflow_cases.edit'); }
  protected get canAddTask(): boolean { return this.auth.hasPermission('workflow_tasks.create'); }
  private get isAdmin(): boolean { return this.auth.hasAnyRole(['system_admin', 'dmo_admin']); }

  protected load(): void {
    this.state.set('loading');
    this.http.get<CaseRow>(`/api/workflow/cases/${this.caseId}`).subscribe({
      next: (c) => {
        this.wfCase.set(c);
        this.state.set('ok');
        this.loadTokenTrace();
      },
      error: () => this.state.set('error'),
    });
  }

  protected loadTokenTrace(): void {
    if (!this.caseId) return;
    this.tokenTraceState.set('loading');
    this.http.get<WorkflowTokenTrace>(`/api/workflow/cases/${this.caseId}/tokens`).subscribe({
      next: (trace) => {
        this.tokenTrace.set(trace);
        this.tokenTraceState.set('ok');
      },
      error: () => {
        this.tokenTrace.set(null);
        this.tokenTraceState.set('error');
      },
    });
  }

  protected readonly canSubmit = computed(() => {
    const c = this.wfCase();
    return !!c && c.status === 'draft' && c.tasks.length > 0 && this.canEdit;
  });

  protected readonly canSuspend = computed(() => {
    const c = this.wfCase();
    return !!c && this.canEdit && !this.isFinalCase(c.status) && c.status !== 'suspended';
  });

  protected readonly canResume = computed(() => {
    const c = this.wfCase();
    return !!c && this.canEdit && c.status === 'suspended';
  });

  protected readonly canCancel = computed(() => {
    const c = this.wfCase();
    return !!c && this.canEdit && !this.isFinalCase(c.status);
  });

  // ---------- helpers ----------
  protected t(key: string): string { return this.i18n.t(key); }
  protected name(o?: { nameEn: string; nameAr: string } | null): string {
    if (!o) return '-';
    return this.i18n.lang() === 'ar' ? o.nameAr : o.nameEn;
  }
  protected personName(p?: { fullNameEn: string; fullNameAr: string } | null): string {
    if (!p) return '-';
    return this.i18n.lang() === 'ar' ? p.fullNameAr : p.fullNameEn;
  }
  protected slaKind(s: string): StatusKind { return SLA_KIND[s] ?? 'muted'; }
  protected caseKind(s: string): StatusKind { return CASE_STATUS_KIND[s] ?? 'muted'; }
  protected approvalKind(s: string): StatusKind { return APPROVAL_KIND[s] ?? 'muted'; }
  protected typeLabel(t: string): string { return this.t('wf.type.' + t); }
  protected fmtDate(d?: string | null): string { return d ? new Date(d).toISOString().slice(0, 10) : '-'; }
  protected fmtDateTime(d?: string | null): string { return d ? new Date(d).toLocaleString() : '-'; }
  protected tokenShort(id?: string | null): string { return id ? id.slice(0, 8) : '-'; }
  protected executionKind(status: string): StatusKind {
    if (status === 'succeeded') return 'success';
    if (status === 'failed') return 'danger';
    if (status === 'paused' || status === 'retrying') return 'warning';
    if (status === 'cancelled') return 'muted';
    return 'info';
  }

  private isFinalCase(status: string): boolean {
    return ['closed', 'implemented', 'rejected', 'cancelled', 'failed'].includes(status);
  }

  /** A task can be decided by its assignee or an admin while still open. */
  protected canDecide(task: Task): boolean {
    if (task.status === 'completed' || task.status === 'cancelled') return false;
    return this.isAdmin || task.assigneeUserId === this.auth.currentUser()?.id;
  }

  protected submitCase(): void {
    const c = this.wfCase();
    if (!c) return;
    this.http.post(`/api/workflow/cases/${c.id}/submit`, {}).subscribe({
      next: () => { this.toast.success(this.t('wf.caseSubmitted')); this.load(); },
      error: (err) => this.toast.errorFrom(err, this.t('wf.saveError')),
    });
  }

  // ---------- decision ----------
  protected openDecision(task: Task, decision: WorkflowDecisionValue): void {
    this.decideTask.set(task);
    this.decision.set(decision);
    this.comment.set('');
  }
  protected closeDecision(): void { this.decideTask.set(null); }

  protected submitDecision(): void {
    const task = this.decideTask();
    if (!task || this.saving()) return;
    this.saving.set(true);
    this.http
      .post(`/api/workflow/tasks/${task.id}/decision`, { decision: this.decision(), comment: this.comment() || null })
      .subscribe({
        next: () => {
          this.toast.success(this.t('wf.decisionRecorded'));
          this.saving.set(false);
          this.decideTask.set(null);
          this.load();
        },
        error: (err) => { this.toast.errorFrom(err, this.t('wf.saveError')); this.saving.set(false); },
      });
  }

  protected openControl(action: 'suspend' | 'resume' | 'cancel'): void {
    this.controlAction.set(action);
    this.controlReason.set('');
    this.controlModalOpen.set(true);
  }

  protected closeControl(): void {
    this.controlModalOpen.set(false);
    this.controlReason.set('');
  }

  protected controlTitle(): string {
    return this.t(`wf.caseControl.${this.controlAction()}.title`);
  }

  protected controlSubmitLabel(): string {
    return this.t(`wf.caseControl.${this.controlAction()}.submit`);
  }

  protected controlReasonRequired(): boolean {
    return this.controlAction() !== 'resume';
  }

  protected submitControl(): void {
    const c = this.wfCase();
    if (!c || this.saving()) return;
    if (this.controlReasonRequired() && !this.controlReason().trim()) {
      this.toast.error(this.t('wf.caseControl.reasonRequired'));
      return;
    }
    const action = this.controlAction();
    this.saving.set(true);
    this.http.post<CaseRow>(`/api/workflow/cases/${c.id}/${action}`, {
      reason: this.controlReason().trim() || null,
    }).subscribe({
      next: () => {
        this.toast.success(this.t(`wf.caseControl.${action}.success`));
        this.saving.set(false);
        this.closeControl();
        this.load();
      },
      error: (err) => {
        this.toast.errorFrom(err, this.t('wf.saveError'));
        this.saving.set(false);
      },
    });
  }

  protected canRetryExecution(status: string): boolean {
    const c = this.wfCase();
    return this.canEdit && !!c && !this.isFinalCase(c.status) && c.status !== 'suspended' && ['failed', 'cancelled'].includes(status);
  }

  protected retryExecution(id: string): void {
    if (this.saving()) return;
    this.saving.set(true);
    this.http.post(`/api/workflow/runtime/executions/${id}/retry`, {}).subscribe({
      next: () => {
        this.toast.success(this.t('wf.execution.retrySuccess'));
        this.saving.set(false);
        this.load();
      },
      error: (err) => {
        this.toast.errorFrom(err, this.t('wf.saveError'));
        this.saving.set(false);
      },
    });
  }

  // ---------- add task ----------
  protected openAddTask(): void {
    this.taskTitle.set('');
    this.taskAssignee.set('');
    this.taskDue.set('');
    this.taskModalOpen.set(true);
  }
  protected closeAddTask(): void { this.taskModalOpen.set(false); }

  protected addTask(): void {
    const c = this.wfCase();
    if (!c || !this.taskTitle().trim() || this.saving()) return;
    this.saving.set(true);
    this.http
      .post(`/api/workflow/cases/${c.id}/tasks`, {
        title: this.taskTitle().trim(),
        type: 'review',
        assigneeUserId: this.taskAssignee() || null,
        dueDate: this.taskDue() ? new Date(this.taskDue()).toISOString() : null,
      })
      .subscribe({
        next: () => {
          this.toast.success(this.t('wf.taskAdded'));
          this.saving.set(false);
          this.taskModalOpen.set(false);
          this.load();
        },
        error: (err) => { this.toast.errorFrom(err, this.t('wf.saveError')); this.saving.set(false); },
      });
  }
}
