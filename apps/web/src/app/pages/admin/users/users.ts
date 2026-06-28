import { ChangeDetectionStrategy, Component, computed, inject, OnInit, signal } from '@angular/core';
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
import { AppIcon } from '../../../shared/app-icon';

interface RoleOption {
  id: string;
  code: string;
  nameEn: string;
  nameAr: string;
}

type State = 'loading' | 'ok' | 'error';
type Mode = 'none' | 'create' | 'edit' | 'roles' | 'reset';
type StatusFilter = 'all' | 'active' | 'inactive';

@Component({
  selector: 'app-users',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [StatusChip, DatePipe, FormsModule, Modal, AppIcon],
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
  protected readonly search = signal('');
  protected readonly statusFilter = signal<StatusFilter>('all');
  protected readonly roleFilter = signal('all');
  protected readonly selectedUserId = signal<string | null>(null);

  protected readonly mode = signal<Mode>('none');
  protected readonly active = signal<AdminUser | null>(null);
  protected readonly saving = signal(false);
  protected readonly formError = signal(false);

  protected form = { email: '', displayName: '', password: '', isActive: true };
  protected readonly roleSel = signal<Set<string>>(new Set());
  protected resetPwd = '';

  protected readonly metrics = computed(() => {
    const users = this.users();
    return {
      total: users.length,
      active: users.filter((u) => u.isActive).length,
      inactive: users.filter((u) => !u.isActive).length,
      noRoles: users.filter((u) => u.roles.length === 0).length,
    };
  });

  protected readonly filteredUsers = computed(() => {
    const query = this.search().trim().toLowerCase();
    const status = this.statusFilter();
    const role = this.roleFilter();

    return this.users().filter((user) => {
      const matchesQuery =
        !query ||
        user.displayName.toLowerCase().includes(query) ||
        user.email.toLowerCase().includes(query);
      const matchesStatus =
        status === 'all' ||
        (status === 'active' && user.isActive) ||
        (status === 'inactive' && !user.isActive);
      const matchesRole =
        role === 'all' || user.roles.some((userRole) => userRole.code === role);

      return matchesQuery && matchesStatus && matchesRole;
    });
  });

  protected readonly selectedUser = computed(() => {
    const users = this.filteredUsers();
    const selectedId = this.selectedUserId();
    return users.find((user) => user.id === selectedId) ?? users[0] ?? null;
  });

  ngOnInit(): void {
    this.load();
  }

  protected load(): void {
    this.state.set('loading');
    forkJoin({
      users: this.http.get<AdminUser[]>('/api/users'),
      roles: this.http.get<RoleOption[]>('/api/users/roles'),
    }).subscribe({
      next: (result) => {
        const selectedId = this.selectedUserId();
        this.users.set(result.users);
        this.roleOptions.set(result.roles);
        if (!selectedId || !result.users.some((user) => user.id === selectedId)) {
          this.selectedUserId.set(result.users[0]?.id ?? null);
        }
        this.state.set('ok');
      },
      error: () => this.state.set('error'),
    });
  }

  protected roleNames(user: AdminUser): string {
    const ar = this.i18n.lang() === 'ar';
    return user.roles.map((role) => (ar ? role.nameAr : role.nameEn)).join(', ') || this.t('users.noRoles');
  }

  protected name(option: { nameEn: string; nameAr: string }): string {
    return this.i18n.lang() === 'ar' ? option.nameAr : option.nameEn;
  }

  protected t(key: string): string {
    return this.i18n.t(key);
  }

  protected selectUser(user: AdminUser): void {
    this.selectedUserId.set(user.id);
  }

  protected clearFilters(): void {
    this.search.set('');
    this.statusFilter.set('all');
    this.roleFilter.set('all');
  }

  protected initials(user: AdminUser): string {
    const source = user.displayName.trim() || user.email;
    return source
      .split(/[\s._@-]+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((part) => part[0]?.toUpperCase() ?? '')
      .join('');
  }

  protected roleSummary(user: AdminUser): string {
    if (!user.roles.length) return this.t('users.noRoles');
    const first = this.name(user.roles[0]);
    const remaining = user.roles.length - 1;
    return remaining > 0 ? `${first} +${remaining}` : first;
  }

  protected isSensitiveRole(role: RoleOption): boolean {
    return role.code === 'system_admin' || role.code.includes('admin');
  }

  protected selectedRoleCount(): number {
    return this.roleSel().size;
  }

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

  protected openEdit(user: AdminUser): void {
    this.form = {
      email: user.email,
      displayName: user.displayName,
      password: '',
      isActive: user.isActive,
    };
    this.active.set(user);
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

  protected async toggleActive(user: AdminUser): Promise<void> {
    if (user.isActive) {
      const ok = await this.confirm.ask('users.confirmDeactivate');
      if (!ok) return;
    }
    this.http.patch(`/api/users/${user.id}`, { isActive: !user.isActive }).subscribe({
      next: () => {
        this.toast.success(this.t('users.updated'));
        this.load();
      },
      error: () => this.toast.error(this.t('users.saveError')),
    });
  }

  protected openRoles(user: AdminUser): void {
    this.roleSel.set(new Set(user.roles.map((role) => role.code)));
    this.active.set(user);
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

  protected openReset(user: AdminUser): void {
    this.resetPwd = '';
    this.active.set(user);
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
