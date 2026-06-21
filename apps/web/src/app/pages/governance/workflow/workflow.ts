import { ChangeDetectionStrategy, Component, inject, OnInit, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { HttpClient } from '@angular/common/http';
import { I18nService } from '../../../core/i18n.service';
import { AuthService } from '../../../core/auth.service';
import { ToastService } from '../../../shared/toast.service';
import { Modal } from '../../../shared/modal';
import { StatusChip, StatusKind } from '../../../shared/status-chip';
import {
  SLA_KIND,
  CASE_STATUS_KIND,
  CaseRow,
  Ref,
  Task,
} from './workflow.types';

@Component({
  selector: 'app-workflow',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule, RouterLink, Modal, StatusChip],
  templateUrl: './workflow.html',
  styleUrl: './workflow.scss',
})
export class WorkflowPage implements OnInit {
  private readonly http = inject(HttpClient);
  protected readonly i18n = inject(I18nService);
  private readonly auth = inject(AuthService);
  private readonly toast = inject(ToastService);

  protected readonly tab = signal<'tasks' | 'cases'>('tasks');
  protected readonly state = signal<'loading' | 'ok' | 'error'>('loading');
  protected readonly tasks = signal<Task[]>([]);
  protected readonly cases = signal<CaseRow[]>([]);
  protected readonly assets = signal<Ref[]>([]);

  // decision modal
  protected readonly decideTask = signal<Task | null>(null);
  protected readonly decision = signal<'approved' | 'rejected'>('approved');
  protected readonly comment = signal('');
  protected readonly saving = signal(false);

  // new case modal
  protected readonly caseModalOpen = signal(false);
  protected readonly newTitle = signal('');
  protected readonly newDescription = signal('');
  protected readonly newAssetId = signal('');

  ngOnInit(): void {
    this.loadAll();
    this.http.get<Ref[]>('/api/assets').subscribe((a) => this.assets.set(a));
  }

  protected get canViewCases(): boolean { return this.auth.hasPermission('workflow_cases.view'); }
  protected get canCreateCase(): boolean { return this.auth.hasPermission('workflow_cases.create'); }

  protected loadAll(): void {
    this.state.set('loading');
    this.http.get<Task[]>('/api/workflow/tasks/mine?status=open').subscribe({
      next: (t) => { this.tasks.set(t); this.state.set('ok'); },
      error: () => this.state.set('error'),
    });
    if (this.canViewCases) {
      this.http.get<CaseRow[]>('/api/workflow/cases').subscribe({
        next: (c) => this.cases.set(c),
        error: () => {},
      });
    }
  }

  // ---------- helpers ----------
  protected t(key: string): string { return this.i18n.t(key); }
  protected name(o?: { nameEn: string; nameAr: string } | null): string {
    if (!o) return '-';
    return this.i18n.lang() === 'ar' ? o.nameAr : o.nameEn;
  }
  protected slaKind(s: string): StatusKind { return SLA_KIND[s] ?? 'muted'; }
  protected caseKind(s: string): StatusKind { return CASE_STATUS_KIND[s] ?? 'muted'; }
  protected typeLabel(t: string): string { return this.t('wf.type.' + t); }
  protected fmtDate(d?: string | null): string {
    return d ? new Date(d).toISOString().slice(0, 10) : '-';
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
      .post(`/api/workflow/tasks/${task.id}/decision`, {
        decision: this.decision(),
        comment: this.comment() || null,
      })
      .subscribe({
        next: () => {
          this.toast.success(this.t('wf.decisionRecorded'));
          this.saving.set(false);
          this.decideTask.set(null);
          this.loadAll();
        },
        error: () => { this.toast.error(this.t('wf.saveError')); this.saving.set(false); },
      });
  }

  // ---------- new case ----------
  protected openNewCase(): void {
    this.newTitle.set('');
    this.newDescription.set('');
    this.newAssetId.set('');
    this.caseModalOpen.set(true);
  }
  protected closeNewCase(): void { this.caseModalOpen.set(false); }

  protected createCase(): void {
    if (!this.newTitle().trim() || this.saving()) return;
    this.saving.set(true);
    this.http
      .post<CaseRow>('/api/workflow/cases', {
        title: this.newTitle().trim(),
        description: this.newDescription() || null,
        assetId: this.newAssetId() || null,
      })
      .subscribe({
        next: () => {
          this.toast.success(this.t('wf.caseCreated'));
          this.saving.set(false);
          this.caseModalOpen.set(false);
          this.tab.set('cases');
          this.loadAll();
        },
        error: () => { this.toast.error(this.t('wf.saveError')); this.saving.set(false); },
      });
  }
}
