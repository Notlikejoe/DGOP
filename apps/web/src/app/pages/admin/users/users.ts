import { ChangeDetectionStrategy, Component, inject, OnInit, signal } from '@angular/core';
import { DatePipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { HttpClient } from '@angular/common/http';
import { forkJoin } from 'rxjs';
import { I18nService } from '../../../core/i18n.service';
import { AuthService } from '../../../core/auth.service';
import { AdminUser } from '../../../core/auth.models';
import { ToastService } from '../../../shared/toast.service';
import { ConfirmService } from '../../../shared/confirm.service';
import { Modal } from '../../../shared/modal';
import { StatusChip } from '../../../shared/status-chip';

interface RoleOption {
  id: string;
  code: string;
  nameEn: string;
  nameAr: string;
}

type State = 'loading' | 'ok' | 'error';
type Mode = 'none' | 'create' | 'edit' | 'roles' | 'reset';

@Component({
  selector: 'app-users',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [StatusChip, DatePipe, FormsModule, Modal],
  templateUrl: './users.html',
  styleUrl: './users.scss',
})
export class UsersPage implements OnInit {
  private readonly http = inject(HttpClient);
  protected readonly i18n = inject(I18nService);
  protected readonly auth = inject(AuthService);
  private readonly toast = inject(ToastService);
  private readonly confirm = inject(ConfirmService);

  protected readonly state = signal<State>('loading');
  protected readonly users = signal<AdminUser[]>([]);
  protected readonly roleOptions = signal<RoleOption[]>([]);

  protected readonly mode = signal<Mode>('none');
  protected readonly active = signal<AdminUser | null>(null);
  protected readonly saving = signal(false);
  protected readonly formError = signal(false);

  protected form = { email: '', displayName: '', password: '', isActive: true };
  protected readonly roleSel = signal<Set<string>>(new Set());
  protected resetPwd = '';

  ngOnInit(): void {
    this.load();
  }

  protected load(): void {
    this.state.set('loading');
    forkJoin({
      users: this.http.get<AdminUser[]>('/api/users'),
      roles: this.http.get<RoleOption[]>('/api/users/roles'),
    }).subscribe({
      next: (r) => {
        this.users.set(r.users);
        this.roleOptions.set(r.roles);
        this.state.set('ok');
      },
      error: () => this.state.set('error'),
    });
  }

  protected roleNames(u: AdminUser): string {
    const ar = this.i18n.lang() === 'ar';
    return u.roles.map((r) => (ar ? r.nameAr : r.nameEn)).join(', ') || '—';
  }

  protected name(o: { nameEn: string; nameAr: string }): string {
    return this.i18n.lang() === 'ar' ? o.nameAr : o.nameEn;
  }

  protected t(key: string): string {
    return this.i18n.t(key);
  }

  // --- Create ---
  protected openCreate(): void {
    this.form = { email: '', displayName: '', password: '', isActive: true };
    this.roleSel.set(new Set());
    this.active.set(null);
    this.formError.set(false);
    this.mode.set('create');
  }

  protected saveCreate(): void {
    if (
      !this.form.email.trim() ||
      !this.form.displayName.trim() ||
      this.form.password.length < 8
    ) {
      this.formError.set(true);
      return;
    }
    this.saving.set(true);
    this.http
      .post('/api/users', {
        email: this.form.email.trim(),
        displayName: this.form.displayName.trim(),
        password: this.form.password,
        roleCodes: [...this.roleSel()],
      })
      .subscribe({
        next: () => {
          this.saving.set(false);
          this.toast.success(this.t('users.created'));
          this.close();
          this.load();
        },
        error: () => {
          this.saving.set(false);
          this.formError.set(true);
          this.toast.error(this.t('users.saveError'));
        },
      });
  }

  // --- Edit (displayName + active) ---
  protected openEdit(u: AdminUser): void {
    this.form = { email: u.email, displayName: u.displayName, password: '', isActive: u.isActive };
    this.active.set(u);
    this.formError.set(false);
    this.mode.set('edit');
  }

  protected saveEdit(): void {
    if (!this.form.displayName.trim()) {
      this.formError.set(true);
      return;
    }
    this.saving.set(true);
    this.http
      .patch(`/api/users/${this.active()!.id}`, {
        displayName: this.form.displayName.trim(),
        isActive: this.form.isActive,
      })
      .subscribe({
        next: () => {
          this.saving.set(false);
          this.toast.success(this.t('users.updated'));
          this.close();
          this.load();
        },
        error: () => {
          this.saving.set(false);
          this.formError.set(true);
          this.toast.error(this.t('users.saveError'));
        },
      });
  }

  protected async toggleActive(u: AdminUser): Promise<void> {
    if (u.isActive) {
      const ok = await this.confirm.ask('users.confirmDeactivate');
      if (!ok) return;
    }
    this.http.patch(`/api/users/${u.id}`, { isActive: !u.isActive }).subscribe({
      next: () => {
        this.toast.success(this.t('users.updated'));
        this.load();
      },
      error: () => this.toast.error(this.t('users.saveError')),
    });
  }

  // --- Roles assignment ---
  protected openRoles(u: AdminUser): void {
    this.roleSel.set(new Set(u.roles.map((r) => r.code)));
    this.active.set(u);
    this.mode.set('roles');
  }

  protected roleChecked(code: string): boolean {
    return this.roleSel().has(code);
  }

  protected toggleRole(code: string): void {
    const next = new Set(this.roleSel());
    if (next.has(code)) next.delete(code);
    else next.add(code);
    this.roleSel.set(next);
  }

  protected saveRoles(): void {
    this.saving.set(true);
    this.http
      .put(`/api/users/${this.active()!.id}/roles`, { roleCodes: [...this.roleSel()] })
      .subscribe({
        next: () => {
          this.saving.set(false);
          this.toast.success(this.t('users.rolesUpdated'));
          this.close();
          this.load();
        },
        error: () => {
          this.saving.set(false);
          this.toast.error(this.t('users.saveError'));
        },
      });
  }

  // --- Reset password ---
  protected openReset(u: AdminUser): void {
    this.resetPwd = '';
    this.active.set(u);
    this.formError.set(false);
    this.mode.set('reset');
  }

  protected saveReset(): void {
    if (this.resetPwd.length < 8) {
      this.formError.set(true);
      return;
    }
    this.saving.set(true);
    this.http
      .post(`/api/users/${this.active()!.id}/reset-password`, { password: this.resetPwd })
      .subscribe({
        next: () => {
          this.saving.set(false);
          this.toast.success(this.t('users.passwordReset'));
          this.close();
        },
        error: () => {
          this.saving.set(false);
          this.formError.set(true);
          this.toast.error(this.t('users.saveError'));
        },
      });
  }

  protected close(): void {
    this.mode.set('none');
    this.active.set(null);
  }
}
