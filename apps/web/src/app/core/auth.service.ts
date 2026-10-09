import { DOCUMENT } from '@angular/common';
import { HttpClient } from '@angular/common/http';
import { DestroyRef, Injectable, computed, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import { firstValueFrom, Subject, takeUntil, timeout } from 'rxjs';
import { AiCapabilities, LoginResponse, UserProfile } from './auth.models';
import { canAccessPage } from './page-access';

const LEGACY_TOKEN_KEY = 'dgop.token';
export class SessionUnavailableError extends Error {}

@Injectable({ providedIn: 'root' })
export class AuthService {
  private readonly http = inject(HttpClient);
  private readonly router = inject(Router);
  private readonly document = inject(DOCUMENT);
  private epoch = 0;
  private lastVerifiedAt = 0;
  private pollTimer?: ReturnType<typeof setInterval>;
  private freshnessTimer?: ReturnType<typeof setTimeout>;
  private loginCancel?: Subject<void>;
  private inFlight?: { epoch: number; cancel: Subject<void>; promise: Promise<UserProfile | null> };
  readonly currentUser = signal<UserProfile | null>(null);
  readonly isAuthenticated = computed(() => this.currentUser() !== null);
  readonly aiCapabilities = computed(() => this.currentUser()?.aiCapabilities ?? null);
  private readonly invalidated = new Subject<void>();
  readonly accessInvalidated$ = this.invalidated.asObservable();
  readonly canWrite = computed(() => this.isAuthenticated() && this.accessStatus() === 'current');
  /** Changes only when effective access changes; page reset is integrated in Batch 2. */
  readonly accessGeneration = signal(0);
  readonly accessStatus = signal<'unknown' | 'current' | 'checking' | 'unavailable'>('unknown');

  constructor() {
    const resume = () => {
      if (!this.visible()) { this.stopTimers(); return; }
      if (!this.isAuthenticated()) return;
      this.accessStatus.set('checking'); this.startTimers(); void this.refreshAccess();
    };
    this.document.addEventListener('visibilitychange', resume);
    this.document.defaultView?.addEventListener('focus', resume);
    this.document.defaultView?.addEventListener('online', resume);
    inject(DestroyRef).onDestroy(() => {
      this.clearSession();
      this.document.removeEventListener('visibilitychange', resume);
      this.document.defaultView?.removeEventListener('focus', resume);
      this.document.defaultView?.removeEventListener('online', resume);
    });
  }
  get sessionEpoch(): number { return this.epoch; }
  getToken(): string | null { return null; }
  private visible(): boolean { return this.document.visibilityState !== 'hidden'; }
  private clearToken(): void {
    try { localStorage.removeItem(LEGACY_TOKEN_KEY); } catch { /* Cookie authentication works without local storage. */ }
  }
  private probe(epoch: number, milliseconds: number): Promise<UserProfile | null> {
    if (this.inFlight?.epoch === epoch) return this.inFlight.promise;
    const cancel = new Subject<void>();
    const pending = { epoch, cancel, promise: Promise.resolve(null) as Promise<UserProfile | null> };
    pending.promise = firstValueFrom(this.http.get<UserProfile | null>('/api/auth/session').pipe(timeout(milliseconds), takeUntil(cancel)))
      .finally(() => { if (this.inFlight === pending) this.inFlight = undefined; cancel.complete(); });
    this.inFlight = pending;
    return pending.promise;
  }
  private revision(user: UserProfile | null): string | undefined {
    return user ? user.accessRevision ?? JSON.stringify([user.roles, user.permissions, user.scopes, user.aiCapabilities]) : undefined;
  }
  private apply(user: UserProfile): void {
    const previous = this.currentUser();
    const changed = previous?.id !== user.id || this.revision(previous) !== this.revision(user);
    // All access facts live in this single signal, never separate permission/scope writes.
    if (JSON.stringify(previous) !== JSON.stringify(user)) this.currentUser.set(user);
    this.lastVerifiedAt = Date.now(); this.accessStatus.set('current');
    if (changed) { this.accessGeneration.update(value => value + 1); this.invalidated.next(); }
    this.startTimers();
  }
  private startTimers(): void {
    if (!this.visible() || !this.isAuthenticated()) return;
    this.pollTimer ??= setInterval(() => { if (this.visible()) void this.refreshAccess(); }, 5000);
    clearTimeout(this.freshnessTimer);
    this.freshnessTimer = setTimeout(() => {
      if (this.isAuthenticated() && Date.now() - this.lastVerifiedAt >= 10_000) this.accessStatus.set('unavailable');
    }, Math.max(0, 10_000 - (Date.now() - this.lastVerifiedAt)));
  }
  private stopTimers(): void {
    clearInterval(this.pollTimer); clearTimeout(this.freshnessTimer);
    this.pollTimer = this.freshnessTimer = undefined;
  }
  private cancelProbe(): void {
    const pending = this.inFlight; this.inFlight = undefined;
    pending?.cancel.next(); pending?.cancel.complete();
  }
  async bootstrap(): Promise<void> {
    const epoch = this.epoch;
    try {
      const user = await this.probe(epoch, 10_000);
      if (epoch !== this.epoch) return;
      if (user?.isActive) this.apply(user); else this.clearSession();
    } catch { if (epoch === this.epoch) this.clearSession(); }
  }
  async login(email: string, password: string): Promise<void> {
    this.clearSession(); const epoch = this.epoch;
    const cancel = new Subject<void>(); this.loginCancel = cancel;
    try {
    const res = await firstValueFrom(this.http.post<LoginResponse>('/api/auth/login', { email: email.trim().toLowerCase(), password }).pipe(timeout(15_000), takeUntil(cancel)));
    if (epoch !== this.epoch) throw new SessionUnavailableError('Login was superseded by another session.');
    const user = await this.probe(epoch, 10_000);
    if (epoch !== this.epoch) throw new SessionUnavailableError('Login was superseded by another session.');
    if (!user?.isActive || user.id !== res.user.id) throw new SessionUnavailableError('The browser could not retain the login session.');
    this.clearToken(); this.apply(user);
    } catch (error) {
      if (epoch !== this.epoch) throw new SessionUnavailableError('Login was superseded by another session.');
      throw error;
    } finally { if (this.loginCancel === cancel) this.loginCancel = undefined; cancel.complete(); }
  }
  async refreshAccess(): Promise<void> {
    const userId = this.currentUser()?.id, epoch = this.epoch;
    if (!userId || !this.visible()) return;
    try {
      const user = await this.probe(epoch, 3000);
      if (epoch !== this.epoch || this.currentUser()?.id !== userId) return;
      if (!user?.isActive || user.id !== userId) {
        this.clearSession(); void this.router.navigate(['/login']); return;
      }
      this.apply(user);
    } catch {
      if (epoch !== this.epoch) return;
      if (Date.now() - this.lastVerifiedAt >= 10_000) this.accessStatus.set('unavailable');
      // Preserve the session during transport failures; Batch 2 covers protected content.
    }
  }
  /** A successful local administrator save invalidates any older in-flight snapshot. */
  notifyAccessChanged(expectedEpoch: number): void {
    if (expectedEpoch !== this.epoch) return;
    this.cancelProbe(); this.accessStatus.set('checking'); void this.refreshAccess();
  }
  async logout(): Promise<void> {
    this.clearSession(); const epoch = this.epoch;
    try { await firstValueFrom(this.http.post('/api/auth/logout', {}).pipe(timeout(3000))); } catch { /* Best effort. */ }
    if (epoch === this.epoch) void this.router.navigate(['/login']);
  }
  clearSession(): void {
    this.loginCancel?.next(); this.loginCancel?.complete(); this.loginCancel = undefined;
    ++this.epoch; this.cancelProbe(); this.stopTimers(); this.clearToken();
    this.currentUser.set(null); this.accessStatus.set('unknown'); this.lastVerifiedAt = 0;
    this.invalidated.next();
  }
  hasPermission(permission: string): boolean {
    if (/^case\.(create|view|approve)\.(aiuc|airs)(\.|$)|^(aiuc|airs)\.|^dashboard\.view\.(aiuc|airs|exec\.ai)$|^refdata\.(propose|approve)\.ai$|^refdata\.publish$/.test(permission)) {
      return this.hasAiPermission(permission);
    }
    const perms = this.currentUser()?.permissions ?? [];
    return perms.includes('*') || perms.includes(permission);
  }
  async refreshAiCapabilities(): Promise<void> { await this.refreshAccess(); }
  hasAiPermission(permission: string): boolean { return this.aiCapabilities()?.permissions.includes(permission) ?? false; }
  hasAiScreen(screen: keyof AiCapabilities['screens']): boolean { return this.aiCapabilities()?.screens[screen] ?? false; }
  canAccessPage(url: string): boolean { return canAccessPage(this, url); }
  hasAnyRole(codes: string[]): boolean {
    const roles = this.currentUser()?.roles.map(r => r.code) ?? [];
    return roles.includes('system_admin') || codes.some(c => roles.includes(c));
  }
}
