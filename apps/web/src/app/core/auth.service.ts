import { HttpClient } from '@angular/common/http';
import { Injectable, computed, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import { firstValueFrom, timeout } from 'rxjs';
import { AiCapabilities, LoginResponse, UserProfile } from './auth.models';

const LEGACY_TOKEN_KEY = 'dgop.token';
export class SessionUnavailableError extends Error {}

@Injectable({ providedIn: 'root' })
export class AuthService {
  private readonly http = inject(HttpClient);
  private readonly router = inject(Router);

  readonly currentUser = signal<UserProfile | null>(null);
  readonly aiCapabilities = signal<AiCapabilities | null>(null);
  readonly isAuthenticated = computed(() => this.currentUser() !== null);
  private capabilityGeneration=0;

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
      if(user) await this.refreshAiCapabilities();
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
    await this.refreshAiCapabilities();
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
    this.capabilityGeneration++;
    this.clearToken();
    this.currentUser.set(null);
    this.aiCapabilities.set(null);
  }

  async refreshAiCapabilities():Promise<void> {
    const generation=++this.capabilityGeneration,userId=this.currentUser()?.id;
    if(!userId){this.aiCapabilities.set(null);return;}
    try {const capabilities=await firstValueFrom(this.http.get<AiCapabilities>('/api/ai/capabilities').pipe(timeout(10000)));if(generation===this.capabilityGeneration&&this.currentUser()?.id===userId)this.aiCapabilities.set(capabilities);}
    catch {if(generation===this.capabilityGeneration)this.aiCapabilities.set(null);}
  }

  hasAiPermission(permission:string):boolean { return this.aiCapabilities()?.permissions.includes(permission)??false; }
  hasAiScreen(screen:keyof AiCapabilities['screens']):boolean { return this.aiCapabilities()?.screens[screen]??false; }

  hasPermission(permission: string): boolean {
    if(/^(?:case\.(?:view|create|approve)\.ai|aiuc\.|airs\.|dashboard\.view\.(?:aiuc|airs|exec\.ai)|refdata\.(?:propose|approve)\.ai|refdata\.publish$)/u.test(permission))return this.hasAiPermission(permission);
    const perms = this.currentUser()?.permissions ?? [];
    return perms.includes('*') || perms.includes(permission);
  }

  hasAnyRole(codes: string[]): boolean {
    const roles = this.currentUser()?.roles.map((r) => r.code) ?? [];
    return roles.includes('system_admin') || codes.some((c) => roles.includes(c));
  }
}
