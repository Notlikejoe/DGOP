import { provideHttpClient, HttpErrorResponse } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';
import { TimeoutError } from 'rxjs';
import { vi } from 'vitest';
import { AuthService, SessionUnavailableError } from './auth.service';
import { UserProfile } from './auth.models';
import { loginErrorKey, loginReturnUrl } from '../pages/login/login.logic';

describe('Cookie login reliability', () => {
  let auth: AuthService;
  let http: HttpTestingController;
  const user: UserProfile = {
    id: 'test-admin', email: 'admin@dgop.local', displayName: 'Administrator',
    isActive: true, lastLoginAt: null, roles: [], permissions: [],
  };

  beforeEach(() => {
    TestBed.configureTestingModule({ providers: [provideHttpClient(), provideHttpClientTesting(), provideRouter([])] });
    auth = TestBed.inject(AuthService);
    http = TestBed.inject(HttpTestingController);
    vi.spyOn(TestBed.inject(Router), 'navigate').mockResolvedValue(true);
  });
  afterEach(() => {
    auth.clearSession();
    http.verify();
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  async function hydrate(revision = 'v1') {
    const promise = auth.bootstrap();
    http.expectOne('/api/auth/session').flush({ ...user, accessRevision: revision });
    await promise;
  }

  it('polls once every five seconds, uses one flight and does not reset unchanged access', async () => {
    vi.useFakeTimers(); await hydrate();
    const generation = auth.accessGeneration();
    await vi.advanceTimersByTimeAsync(4999); http.expectNone('/api/auth/session');
    await vi.advanceTimersByTimeAsync(1);
    const request = http.expectOne('/api/auth/session');
    const a = auth.refreshAccess(), b = auth.refreshAccess();
    http.expectNone('/api/auth/session');
    request.flush({ ...user, accessRevision: 'v1' }); await Promise.all([a,b]);
    expect(auth.accessGeneration()).toBe(generation);
    await vi.advanceTimersByTimeAsync(5000);
    const refreshed = auth.refreshAccess();
    http.expectOne('/api/auth/session').flush({ ...user, accessRevision:'v2', permissions:['assets.view'] });
    await refreshed;
    expect(auth.hasPermission('assets.view')).toBe(true);
    expect(auth.accessGeneration()).toBe(generation + 1);
  });

  it('pauses hidden tabs and checks immediately on return', async () => {
    vi.useFakeTimers(); await hydrate();
    const visibility = vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden');
    document.dispatchEvent(new Event('visibilitychange'));
    await vi.advanceTimersByTimeAsync(20_000); http.expectNone('/api/auth/session');
    visibility.mockReturnValue('visible'); document.dispatchEvent(new Event('visibilitychange'));
    expect(auth.accessStatus()).toBe('checking');
    const refreshed = auth.refreshAccess();
    http.expectOne('/api/auth/session').flush({ ...user, accessRevision: 'v2' });
    await refreshed;
    expect(auth.accessStatus()).toBe('current');
  });

  it('times out refresh after three seconds, retains session and reports stale access after ten seconds', async () => {
    vi.useFakeTimers(); await hydrate();
    const promise = auth.refreshAccess(); const request = http.expectOne('/api/auth/session');
    await vi.advanceTimersByTimeAsync(3001); await promise;
    expect(request.cancelled).toBe(true); expect(auth.isAuthenticated()).toBe(true);
    await vi.advanceTimersByTimeAsync(1999); const next = http.expectOne('/api/auth/session');
    next.flush('unavailable', {status:503,statusText:'Unavailable'});
    await vi.advanceTimersByTimeAsync(5000); const retry = http.expectOne('/api/auth/session');
    expect(auth.accessStatus()).toBe('unavailable'); expect(auth.isAuthenticated()).toBe(true);
    const recovered = auth.refreshAccess(); retry.flush({ ...user, accessRevision:'v2' }); await recovered;
    expect(auth.accessStatus()).toBe('current');
  });

  it('cancels an old snapshot before a local permission save refresh', async () => {
    await hydrate(); const old = auth.refreshAccess(); const request = http.expectOne('/api/auth/session');
    auth.notifyAccessChanged(auth.sessionEpoch);
    expect(request.cancelled).toBe(true);
    http.expectOne('/api/auth/session').flush({ ...user, accessRevision:'new', permissions:['assets.view'] });
    await old; await Promise.resolve();
    expect(auth.currentUser()?.accessRevision).toBe('new');
  });

  it('cancels an earlier login before it can overwrite the newer browser cookie', async () => {
    const old = auth.login(user.email, 'password'); const rejected = expect(old).rejects.toBeInstanceOf(SessionUnavailableError);
    const oldRequest = http.expectOne('/api/auth/login');
    const newer = auth.login('other@dgop.local','password');
    expect(oldRequest.cancelled).toBe(true);
    http.expectOne('/api/auth/login').flush({user:{...user,id:'other'}}); await Promise.resolve();
    http.expectOne('/api/auth/session').flush({...user,id:'other',accessRevision:'other'}); await newer;
    await rejected;
    expect(auth.currentUser()?.id).toBe('other');
  });

  it('expires verification exactly ten seconds after the last successful off-cycle snapshot', async () => {
    vi.useFakeTimers(); await hydrate();
    await vi.advanceTimersByTimeAsync(5500);
    const verified=auth.refreshAccess();http.expectOne('/api/auth/session').flush({...user,accessRevision:'v1'});await verified;
    await vi.advanceTimersByTimeAsync(4500);
    const failed=auth.refreshAccess();http.expectOne('/api/auth/session').flush({}, {status:503,statusText:'Unavailable'});await failed;
    await vi.advanceTimersByTimeAsync(5000);
    const retry=auth.refreshAccess();http.expectOne('/api/auth/session').flush({}, {status:503,statusText:'Unavailable'});await retry;
    await vi.advanceTimersByTimeAsync(499);expect(auth.accessStatus()).toBe('current');
    await vi.advanceTimersByTimeAsync(1);expect(auth.accessStatus()).toBe('unavailable');
  });

  it('clears a disabled or invalid session rather than applying it', async () => {
    await hydrate(); const promise = auth.refreshAccess();
    http.expectOne('/api/auth/session').flush(null); await promise;
    expect(auth.isAuthenticated()).toBe(false);
  });

  it('does not turn an ineligible generic AI grant into a business action', async () => {
    const loaded=auth.bootstrap();
    const ai={administratorOversight:false,readMode:'own',permissions:['case.view.aiuc.own'],screens:{useCases:true,risks:false,review:false,reviewOperations:false,dashboard:false,migration:false},panels:{classificationVerification:false,registration:false}};
    http.expectOne('/api/auth/session').flush({...user,permissions:['case.view.aiuc.own','case.approve.aiuc'],aiCapabilities:ai,accessRevision:'ai'});await loaded;
    expect(auth.hasPermission('case.view.aiuc.own')).toBe(true);expect(auth.hasPermission('case.approve.aiuc')).toBe(false);
  });

  it('normalizes email and requires a retained cookie before becoming authenticated', async () => {
    const promise = auth.login(' ADMIN@DGOP.LOCAL ', ' Exact Password ');
    const request = http.expectOne('/api/auth/login');
    expect(request.request.body).toEqual({ email: user.email, password: ' Exact Password ' });
    request.flush({ user });
    await Promise.resolve();
    expect(auth.isAuthenticated()).toBe(false);
    http.expectOne('/api/auth/session').flush(user);
    await promise;
    expect(auth.currentUser()).toEqual(user);
  });

  it('reports missing browser cookies instead of navigating into a login loop', async () => {
    const promise = auth.login(user.email, 'test-password');
    const rejected = expect(promise).rejects.toBeInstanceOf(SessionUnavailableError);
    http.expectOne('/api/auth/login').flush({ user });
    await Promise.resolve();
    http.expectOne('/api/auth/session').flush(null);
    await rejected;
    expect(auth.isAuthenticated()).toBe(false);
  });

  it('does not fail a valid login when legacy local storage is blocked', async () => {
    vi.spyOn(Storage.prototype, 'removeItem').mockImplementation(() => { throw new DOMException('Blocked', 'SecurityError'); });
    const promise = auth.login(user.email, 'test-password');
    http.expectOne('/api/auth/login').flush({ user });
    await Promise.resolve();
    http.expectOne('/api/auth/session').flush(user);
    await promise;
    expect(auth.isAuthenticated()).toBe(true);
  });

  it('times out a stalled login instead of leaving the submit action loading', async () => {
    vi.useFakeTimers();
    const promise = auth.login(user.email, 'test-password');
    const rejected = expect(promise).rejects.toBeInstanceOf(TimeoutError);
    const request = http.expectOne('/api/auth/login');
    await vi.advanceTimersByTimeAsync(15_001);
    await rejected;
    expect(request.cancelled).toBe(true);
  });

  it('rejects a retained cookie belonging to a different account', async () => {
    const promise = auth.login(user.email, 'test-password');
    const rejected = expect(promise).rejects.toBeInstanceOf(SessionUnavailableError);
    http.expectOne('/api/auth/login').flush({ user });
    await Promise.resolve();
    http.expectOne('/api/auth/session').flush({ ...user, id: 'previous-user' });
    await rejected;
    expect(auth.isAuthenticated()).toBe(false);
  });

  it('lets startup finish when the session service does not respond', async () => {
    vi.useFakeTimers();
    const promise = auth.bootstrap();
    const request = http.expectOne('/api/auth/session');
    await vi.advanceTimersByTimeAsync(10_001);
    await promise;
    expect(request.cancelled).toBe(true);
    expect(auth.isAuthenticated()).toBe(false);
  });

  it('distinguishes bad credentials, rate limiting, timeouts and unavailable services', () => {
    expect(loginErrorKey(new HttpErrorResponse({ status: 401 }))).toBe('login.invalid');
    expect(loginErrorKey(new HttpErrorResponse({ status: 429 }))).toBe('login.rateLimited');
    expect(loginErrorKey(new HttpErrorResponse({ status: 503 }))).toBe('login.serviceUnavailable');
    expect(loginErrorKey(new HttpErrorResponse({ status: 0 }))).toBe('login.serviceUnavailable');
    expect(loginErrorKey(new TimeoutError())).toBe('login.timedOut');
    expect(loginErrorKey(new SessionUnavailableError())).toBe('login.sessionUnavailable');
  });

  it('rejects external return URLs and login self-redirects', () => {
    for (const url of [null, '//example.com', 'https://example.com', '/login', '/login?returnUrl=/login', '/\\example.com']) {
      expect(loginReturnUrl(url)).toBe('/dashboard');
    }
    expect(loginReturnUrl('/governance/training?tab=courses')).toBe('/governance/training?tab=courses');
  });
});
