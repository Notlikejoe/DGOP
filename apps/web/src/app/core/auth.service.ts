import { HttpClient } from '@angular/common/http';
import { Injectable, computed, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import { firstValueFrom, timeout } from 'rxjs';
import { LoginResponse, UserProfile } from './auth.models';

const LEGACY_TOKEN_KEY = 'dgop.token';
export class SessionUnavailableError extends Error {}

@Injectable({ providedIn: 'root' })
export class AuthService {
  private readonly http = inject(HttpClient);
  private readonly router = inject(Router);

  readonly currentUser = signal<UserProfile | null>(null);
  readonly isAuthenticated = computed(() => this.currentUser() !== null);

  getToken(): string | null {
    return null;
  }

  private clearToken(): void {
    try {
      localStorage.removeItem(LEGACY_TOKEN_KEY);
    } catch {
      // Legacy storage cleanup must not block HTTP-only cookie authentication.
    }
  }

  /** Called at app startup: if the HTTP-only session cookie exists, hydrate the current user. */
  async bootstrap(): Promise<void> {
    try {
      const user = await firstValueFrom(this.http.get<UserProfile | null>('/api/auth/session').pipe(timeout(10_000)));
      this.currentUser.set(user);
    } catch {
      this.clearSession();
    }
  }

  async login(email: string, password: string): Promise<void> {
    const res = await firstValueFrom(
      this.http.post<LoginResponse>('/api/auth/login', { email: email.trim().toLowerCase(), password }).pipe(timeout(15_000)),
    );
    const user = await firstValueFrom(this.http.get<UserProfile | null>('/api/auth/session').pipe(timeout(10_000)));
    if (!user?.isActive || user.id !== res.user.id) throw new SessionUnavailableError('The browser could not retain the login session.');
    this.clearToken();
    this.currentUser.set(user);
  }

  async logout(): Promise<void> {
    try {
      await firstValueFrom(this.http.post('/api/auth/logout', {}));
    } catch {
      // best effort; stateless logout
    }
    this.clearSession();
    void this.router.navigate(['/login']);
  }

  /** Clear local session without an API call (used on 401). */
  clearSession(): void {
    this.clearToken();
    this.currentUser.set(null);
  }

  hasPermission(permission: string): boolean {
    const perms = this.currentUser()?.permissions ?? [];
    return perms.includes('*') || perms.includes(permission);
  }

  hasAnyRole(codes: string[]): boolean {
    const roles = this.currentUser()?.roles.map((r) => r.code) ?? [];
    return codes.some((c) => roles.includes(c));
  }
}
