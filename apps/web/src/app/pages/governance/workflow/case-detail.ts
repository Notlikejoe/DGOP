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
} from './workflow.types';

const CASE_STATUSES = [
  'draft', 'submitted', 'under_review', 'awaiting_information',
  'decision_made', 'approved', 'rejected', 'implemented', 'closed',
];

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

  protected readonly caseStatuses = CASE_STATUSES;
  protected readonly state = signal<'loading' | 'ok' | 'error'>('loading');
  protected readonly wfCase = signal<CaseRow | null>(null);
  protected readonly users = signal<UserRef[]>([]);
  private caseId = '';

  // decision modal
  protected readonly decideTask = signal<Task | null>(null);
  protected readonly decision = signal<'approved' | 'rejected'>('approved');
  protected readonly comment = signal('');
  protected readonly saving = signal(false);

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
      next: (c) => { this.wfCase.set(c); this.state.set('ok'); },
      error: () => this.state.set('error'),
    });
  }

  protected readonly canSubmit = computed(() => {
    const c = this.wfCase();
    return !!c && c.status === 'draft' && c.tasks.length > 0 && this.canEdit;
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

  /** A task can be decided by its assignee or an admin while still open. */
  protected canDecide(task: Task): boolean {
    if (task.status === 'completed' || task.status === 'cancelled') return false;
    return this.isAdmin || task.assigneeUserId === this.auth.currentUser()?.id;
  }

  // ---------- status transition ----------
  protected changeStatus(status: string): void {
    const c = this.wfCase();
    if (!c || status === c.status) return;
    this.http.patch(`/api/workflow/cases/${c.id}`, { status }).subscribe({
      next: () => { this.toast.success(this.t('wf.statusUpdated')); this.load(); },
      error: () => this.toast.error(this.t('wf.saveError')),
    });
  }

  protected submitCase(): void {
    const c = this.wfCase();
    if (!c) return;
    this.http.post(`/api/workflow/cases/${c.id}/submit`, {}).subscribe({
      next: () => { this.toast.success(this.t('wf.caseSubmitted')); this.load(); },
      error: () => this.toast.error(this.t('wf.saveError')),
    });
  }

  // ---------- decision ----------
  protected openDecision(task: Task, decision: 'approved' | 'rejected'): void {
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
        error: () => { this.toast.error(this.t('wf.saveError')); this.saving.set(false); },
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
        error: () => { this.toast.error(this.t('wf.saveError')); this.saving.set(false); },
      });
  }
}
