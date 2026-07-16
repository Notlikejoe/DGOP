import { HttpClient } from '@angular/common/http';
import { Injectable, computed, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import { LoginResponse, UserProfile } from './auth.models';

const LEGACY_TOKEN_KEY = 'dgop.token';

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
    localStorage.removeItem(LEGACY_TOKEN_KEY);
  }

  /** Called at app startup: if the HTTP-only session cookie exists, hydrate the current user. */
  async bootstrap(): Promise<void> {
    try {
      const user = await firstValueFrom(this.http.get<UserProfile | null>('/api/auth/session'));
      this.currentUser.set(user);
    } catch {
      this.clearSession();
    }
  }

  async login(email: string, password: string): Promise<void> {
    const res = await firstValueFrom(
      this.http.post<LoginResponse>('/api/auth/login', { email, password }),
    );
    this.clearToken();
    this.currentUser.set(res.user);
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
