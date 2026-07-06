import { ChangeDetectionStrategy, Component, computed, inject, OnInit, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { HttpClient, HttpParams } from '@angular/common/http';
import { forkJoin, of } from 'rxjs';
import { I18nService } from '../../../core/i18n.service';
import { AuthService } from '../../../core/auth.service';
import { ToastService } from '../../../shared/toast.service';
import { Modal } from '../../../shared/modal';
import { StatusChip, StatusKind } from '../../../shared/status-chip';

interface Ref { id: string; code: string; nameEn: string; nameAr: string; }
interface RoleRef extends Ref { isSystem?: boolean; }
interface UserRef { id: string; email: string; displayName: string; }

interface TrainingSummary {
  courses: number;
  mandatoryRequirements: number;
  assignments: number;
  completed: number;
  expired: number;
  overdue: number;
  completionRate: number;
  certificationTracks: number;
  activeCertifications: number;
  ceHours: number;
  communityArticles: number;
  experts: number;
  mentorships: number;
  awarenessReadiness: number;
}

interface TrainingRequirement {
  id: string;
  mandatory: boolean;
  dueDays: number;
  course: Ref & { titleEn?: string; titleAr?: string };
  role: RoleRef;
}

interface TrainingCourse {
  id: string;
  code: string;
  titleEn: string;
  titleAr: string;
  description?: string | null;
  category: string;
  tier: 'tier_1' | 'tier_2' | 'tier_3' | 'tier_4';
  deliveryMethod: string;
  prerequisiteCourse?: { id: string; code: string; titleEn: string; titleAr: string } | null;
  durationMinutes: number;
  validityMonths?: number | null;
  isActive: boolean;
  requirements: Array<{ role: RoleRef; dueDays: number; mandatory: boolean }>;
}

interface TrainingAssignment {
  id: string;
  status: string;
  dueDate?: string | null;
  completedAt?: string | null;
  expiresAt?: string | null;
  score?: number | null;
  course: { id: string; code: string; titleEn: string; titleAr: string; category: string };
  user: UserRef;
  person?: { fullNameEn: string; fullNameAr: string } | null;
}

interface CourseDraft {
  code: string;
  titleEn: string;
  titleAr: string;
  description: string;
  category: string;
  durationMinutes: number;
  validityMonths: number | null;
  tier: 'tier_1' | 'tier_2' | 'tier_3' | 'tier_4';
  deliveryMethod: string;
  prerequisiteCourseId: string | null;
}

interface CertificationTrack {
  id: string;
  code: string;
  level: string;
  nameEn: string;
  nameAr: string;
  description?: string | null;
  requiredTier: string;
  requiredCeHours: number;
  validityMonths: number;
  passScore: number;
  privileges?: string | null;
  attempts: Array<{ id: string; status: string; expiresAt?: string | null }>;
}

interface CertificationAttempt {
  id: string;
  status: string;
  state: string;
  examScore?: number | null;
  expiresAt?: string | null;
  track: CertificationTrack;
  user: UserRef;
  person?: { fullNameEn: string; fullNameAr: string } | null;
}

interface ContinuingEducationActivity {
  id: string;
  titleEn: string;
  titleAr?: string | null;
  activityType: string;
  hours: number;
  activityDate: string;
  user: UserRef;
  person?: { fullNameEn: string; fullNameAr: string } | null;
}

interface CommunityArticle {
  id: string;
  titleEn: string;
  titleAr: string;
  summaryEn?: string | null;
  summaryAr?: string | null;
  category: string;
  contributionPoints: number;
  isFeatured: boolean;
  author?: { fullNameEn: string; fullNameAr: string } | null;
}

interface ExpertProfile {
  id: string;
  expertiseArea: string;
  bio?: string | null;
  contributionPoints: number;
  mentorshipCapacity: number;
  person: { fullNameEn: string; fullNameAr: string; email: string; jobTitle?: string | null };
}

interface MentorshipPair {
  id: string;
  status: string;
  focusArea?: string | null;
  progressNote?: string | null;
  mentor: { fullNameEn: string; fullNameAr: string; email: string };
  mentee: { fullNameEn: string; fullNameAr: string; email: string };
}

@Component({
  selector: 'app-training',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule, Modal, StatusChip],
  templateUrl: './training.html',
  styleUrl: './training.scss',
})
export class TrainingPage implements OnInit {
  private readonly http = inject(HttpClient);
  protected readonly i18n = inject(I18nService);
  private readonly auth = inject(AuthService);
  private readonly toast = inject(ToastService);

  protected readonly state = signal<'loading' | 'ok' | 'error'>('loading');
  protected readonly summary = signal<TrainingSummary | null>(null);
  protected readonly courses = signal<TrainingCourse[]>([]);
  protected readonly requirements = signal<TrainingRequirement[]>([]);
  protected readonly assignments = signal<TrainingAssignment[]>([]);
  protected readonly roles = signal<RoleRef[]>([]);
  protected readonly users = signal<UserRef[]>([]);
  protected readonly certificationTracks = signal<CertificationTrack[]>([]);
  protected readonly certificationAttempts = signal<CertificationAttempt[]>([]);
  protected readonly ceActivities = signal<ContinuingEducationActivity[]>([]);
  protected readonly communityArticles = signal<CommunityArticle[]>([]);
  protected readonly expertProfiles = signal<ExpertProfile[]>([]);
  protected readonly mentorshipPairs = signal<MentorshipPair[]>([]);

  protected readonly search = signal('');
  protected readonly status = signal('');

  protected readonly courseOpen = signal(false);
  protected readonly requirementOpen = signal(false);
  protected readonly assignmentOpen = signal(false);
  protected readonly completeTarget = signal<TrainingAssignment | null>(null);
  protected readonly saving = signal(false);
  protected readonly syncing = signal(false);

  protected readonly courseDraft = signal<CourseDraft>(this.emptyCourse());
  protected readonly requirementCourseId = signal('');
  protected readonly requirementRoleId = signal('');
  protected readonly requirementDueDays = signal(30);
  protected readonly requirementMandatory = signal(true);
  protected readonly assignmentCourseId = signal('');
  protected readonly assignmentUserId = signal('');
  protected readonly assignmentDueDate = signal('');
  protected readonly completeScore = signal<number | null>(null);
  protected readonly completeNote = signal('');

  protected readonly filteredCourses = computed(() => {
    const term = this.search().trim().toLowerCase();
    return this.courses().filter((c) => {
      if (!term) return true;
      return [c.code, c.titleEn, c.titleAr, c.category].some((v) => v.toLowerCase().includes(term));
    });
  });
  protected readonly tierOrder = ['tier_1', 'tier_2', 'tier_3', 'tier_4'] as const;
  protected readonly courseTiers = computed(() =>
    this.tierOrder.map((tier) => ({
      tier,
      courses: this.filteredCourses().filter((c) => c.tier === tier),
    })),
  );
  protected readonly featuredArticles = computed(() =>
    [...this.communityArticles()].sort((a, b) => Number(b.isFeatured) - Number(a.isFeatured)).slice(0, 3),
  );

  ngOnInit(): void {
    this.load();
  }

  protected get canManageCourses(): boolean { return this.auth.hasPermission('training_courses.view'); }
  protected get canCreateCourse(): boolean { return this.auth.hasPermission('training_courses.create'); }
  protected get canManageRequirements(): boolean { return this.auth.hasPermission('training_requirements.create'); }
  protected get canAssign(): boolean { return this.auth.hasPermission('training_assignments.create'); }
  protected get canComplete(): boolean { return this.auth.hasPermission('training_assignments.edit'); }
  protected get canViewCertifications(): boolean { return this.auth.hasPermission('certification_tracks.view'); }
  protected get canViewCommunity(): boolean { return this.auth.hasPermission('community_articles.view'); }
  protected get canViewExperts(): boolean { return this.auth.hasPermission('expert_profiles.view'); }
  protected get canViewMentorships(): boolean { return this.auth.hasPermission('mentorship_pairs.view'); }

  protected load(): void {
    this.state.set('loading');
    this.loadManagementLookups();
    this.loadAwarenessLookups();
    this.loadAssignments();
    this.http.get<TrainingSummary>('/api/training/summary').subscribe({
      next: (s) => this.summary.set(s),
      error: () => this.summary.set(null),
    });
  }

  private loadAwarenessLookups(): void {
    forkJoin({
      tracks: this.canViewCertifications ? this.http.get<CertificationTrack[]>('/api/training/certifications/tracks') : of([] as CertificationTrack[]),
      attempts: this.auth.hasPermission('certification_attempts.view') ? this.http.get<CertificationAttempt[]>('/api/training/certifications/attempts') : of([] as CertificationAttempt[]),
      ce: this.auth.hasPermission('ce_activities.view') ? this.http.get<ContinuingEducationActivity[]>('/api/training/continuing-education') : of([] as ContinuingEducationActivity[]),
      articles: this.canViewCommunity ? this.http.get<CommunityArticle[]>('/api/training/community/articles') : of([] as CommunityArticle[]),
      experts: this.canViewExperts ? this.http.get<ExpertProfile[]>('/api/training/community/experts') : of([] as ExpertProfile[]),
      mentorships: this.canViewMentorships ? this.http.get<MentorshipPair[]>('/api/training/mentorships') : of([] as MentorshipPair[]),
    }).subscribe({
      next: (r) => {
        this.certificationTracks.set(r.tracks);
        this.certificationAttempts.set(r.attempts);
        this.ceActivities.set(r.ce);
        this.communityArticles.set(r.articles);
        this.expertProfiles.set(r.experts);
        this.mentorshipPairs.set(r.mentorships);
      },
      error: () => this.toast.error(this.t('training.error')),
    });
  }

  private loadManagementLookups(): void {
    if (!this.canManageCourses) return;
    forkJoin({
      courses: this.http.get<TrainingCourse[]>('/api/training/courses'),
      requirements: this.http.get<TrainingRequirement[]>('/api/training/requirements'),
      roles: this.http.get<RoleRef[]>('/api/roles'),
      users: this.http.get<UserRef[]>('/api/users'),
    }).subscribe({
      next: (r) => {
        this.courses.set(r.courses);
        this.requirements.set(r.requirements);
        this.roles.set(r.roles);
        this.users.set(r.users);
      },
      error: () => this.toast.error(this.t('training.error')),
    });
  }

  private loadAssignments(): void {
    let params = new HttpParams();
    if (this.status()) params = params.set('status', this.status());
    this.http.get<TrainingAssignment[]>('/api/training/assignments', { params }).subscribe({
      next: (rows) => {
        this.assignments.set(rows);
        this.state.set('ok');
      },
      error: () => this.state.set('error'),
    });
  }

  protected setStatus(value: string): void {
    this.status.set(value);
    this.loadAssignments();
  }

  private emptyCourse(): CourseDraft {
    return {
      code: '',
      titleEn: '',
      titleAr: '',
      description: '',
      category: 'governance',
      durationMinutes: 30,
      validityMonths: 12,
      tier: 'tier_1',
      deliveryMethod: 'self_paced',
      prerequisiteCourseId: null,
    };
  }

  protected setCourse<K extends keyof CourseDraft>(key: K, value: CourseDraft[K]): void {
    this.courseDraft.update((d) => ({ ...d, [key]: value }));
  }

  protected openCourse(): void {
    this.courseDraft.set(this.emptyCourse());
    this.courseOpen.set(true);
  }

  protected saveCourse(): void {
    const d = this.courseDraft();
    if (!d.code || !d.titleEn || !d.titleAr || this.saving()) return;
    this.saving.set(true);
    this.http.post('/api/training/courses', {
      ...d,
      description: d.description || null,
      validityMonths: d.validityMonths || null,
      prerequisiteCourseId: d.prerequisiteCourseId || null,
    }).subscribe({
      next: () => {
        this.toast.success(this.t('training.created'));
        this.saving.set(false);
        this.courseOpen.set(false);
        this.load();
      },
      error: () => { this.toast.error(this.t('training.error')); this.saving.set(false); },
    });
  }

  protected openRequirement(courseId?: string): void {
    this.requirementCourseId.set(courseId ?? '');
    this.requirementRoleId.set('');
    this.requirementDueDays.set(30);
    this.requirementMandatory.set(true);
    this.requirementOpen.set(true);
  }

  protected saveRequirement(): void {
    if (!this.requirementCourseId() || !this.requirementRoleId() || this.saving()) return;
    this.saving.set(true);
    this.http.post('/api/training/requirements', {
      courseId: this.requirementCourseId(),
      roleId: this.requirementRoleId(),
      dueDays: this.requirementDueDays(),
      mandatory: this.requirementMandatory(),
    }).subscribe({
      next: () => {
        this.toast.success(this.t('training.requirementSaved'));
        this.saving.set(false);
        this.requirementOpen.set(false);
        this.load();
      },
      error: () => { this.toast.error(this.t('training.error')); this.saving.set(false); },
    });
  }

  protected openAssignment(courseId?: string): void {
    this.assignmentCourseId.set(courseId ?? '');
    this.assignmentUserId.set('');
    this.assignmentDueDate.set('');
    this.assignmentOpen.set(true);
  }

  protected saveAssignment(): void {
    if (!this.assignmentCourseId() || !this.assignmentUserId() || this.saving()) return;
    this.saving.set(true);
    this.http.post('/api/training/assignments', {
      courseId: this.assignmentCourseId(),
      userId: this.assignmentUserId(),
      dueDate: this.assignmentDueDate() || null,
    }).subscribe({
      next: () => {
        this.toast.success(this.t('training.assignmentSaved'));
        this.saving.set(false);
        this.assignmentOpen.set(false);
        this.load();
      },
      error: () => { this.toast.error(this.t('training.error')); this.saving.set(false); },
    });
  }

  protected openComplete(a: TrainingAssignment): void {
    this.completeTarget.set(a);
    this.completeScore.set(null);
    this.completeNote.set('');
  }

  protected complete(): void {
    const a = this.completeTarget();
    if (!a || this.saving()) return;
    this.saving.set(true);
    this.http.post(`/api/training/assignments/${a.id}/complete`, {
      score: this.completeScore(),
      evidenceNote: this.completeNote() || null,
    }).subscribe({
      next: () => {
        this.toast.success(this.t('training.completed'));
        this.saving.set(false);
        this.completeTarget.set(null);
        this.load();
      },
      error: () => { this.toast.error(this.t('training.error')); this.saving.set(false); },
    });
  }

  protected sync(): void {
    if (this.syncing()) return;
    this.syncing.set(true);
    this.http.post<{ created: number }>('/api/training/assignments/sync', {}).subscribe({
      next: () => {
        this.toast.success(this.t('training.synced'));
        this.syncing.set(false);
        this.load();
      },
      error: () => { this.toast.error(this.t('training.error')); this.syncing.set(false); },
    });
  }

  protected closeModals(): void {
    this.courseOpen.set(false);
    this.requirementOpen.set(false);
    this.assignmentOpen.set(false);
    this.completeTarget.set(null);
  }

  protected name(o?: { nameEn?: string; nameAr?: string; titleEn?: string; titleAr?: string; fullNameEn?: string; fullNameAr?: string } | null): string {
    if (!o) return '-';
    if (this.i18n.lang() === 'ar') return o.nameAr ?? o.titleAr ?? o.fullNameAr ?? o.nameEn ?? o.titleEn ?? o.fullNameEn ?? '-';
    return o.nameEn ?? o.titleEn ?? o.fullNameEn ?? o.nameAr ?? o.titleAr ?? o.fullNameAr ?? '-';
  }

  protected statusKind(status: string): StatusKind {
    if (status === 'completed') return 'success';
    if (status === 'expired') return 'danger';
    if (status === 'in_progress') return 'info';
    if (status === 'waived') return 'muted';
    return this.isOverdueDate(status) ? 'warning' : 'muted';
  }

  protected certificationKind(state: string): StatusKind {
    if (state === 'current' || state === 'passed') return 'success';
    if (state === 'renewal_due' || state === 'in_progress') return 'warning';
    if (state === 'expired' || state === 'failed' || state === 'revoked') return 'danger';
    return 'muted';
  }

  protected tierTitle(tier: string): string {
    return this.t(`training.tier.${tier}`);
  }

  protected tierDetail(tier: string): string {
    return this.t(`training.tier.${tier}.detail`);
  }

  private isOverdueDate(_status: string): boolean {
    return false;
  }

  protected date(value?: string | null): string {
    return value ? new Date(value).toLocaleDateString() : '-';
  }

  protected t(key: string): string {
    return this.i18n.t(key);
  }
}
