import { HttpClient } from '@angular/common/http';
import { Injectable, computed, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import { LoginResponse, UserProfile } from './auth.models';

const TOKEN_KEY = 'dgop.token';

@Injectable({ providedIn: 'root' })
export class AuthService {
  private readonly http = inject(HttpClient);
  private readonly router = inject(Router);

  readonly currentUser = signal<UserProfile | null>(null);
  readonly isAuthenticated = computed(() => this.currentUser() !== null);

  getToken(): string | null {
    return localStorage.getItem(TOKEN_KEY);
  }

  private setToken(token: string): void {
    localStorage.setItem(TOKEN_KEY, token);
  }

  private clearToken(): void {
    localStorage.removeItem(TOKEN_KEY);
  }

  /** Called at app startup: if a token exists, hydrate the current user. */
  async bootstrap(): Promise<void> {
    if (!this.getToken()) return;
    try {
      const user = await firstValueFrom(this.http.get<UserProfile>('/api/auth/me'));
      this.currentUser.set(user);
    } catch {
      this.clearSession();
    }
  }

  async login(email: string, password: string): Promise<void> {
    const res = await firstValueFrom(
      this.http.post<LoginResponse>('/api/auth/login', { email, password }),
    );
    this.setToken(res.accessToken);
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
