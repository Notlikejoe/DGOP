import { provideHttpClient, HttpErrorResponse } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { TimeoutError } from 'rxjs';
import { vi } from 'vitest';
import { AuthService, SessionUnavailableError } from './auth.service';
import { AiCapabilities, UserProfile } from './auth.models';
import { loginErrorKey, loginReturnUrl } from '../pages/login/login.logic';

describe('Cookie login reliability', () => {
  let auth: AuthService;
  let http: HttpTestingController;
  const user: UserProfile = {
    id: 'test-admin', email: 'admin@dgop.local', displayName: 'Administrator',
    isActive: true, lastLoginAt: null, roles: [], permissions: [],
  };
  const noAi:AiCapabilities={administratorOversight:false,readMode:'own',permissions:[],screens:{useCases:false,risks:false,review:false,reviewOperations:false,dashboard:false,migration:false}};

  beforeEach(() => {
    TestBed.configureTestingModule({ providers: [provideHttpClient(), provideHttpClientTesting(), provideRouter([])] });
    auth = TestBed.inject(AuthService);
    http = TestBed.inject(HttpTestingController);
  });
  afterEach(() => {
    http.verify();
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it('normalizes email and requires a retained cookie before becoming authenticated', async () => {
    const promise = auth.login(' ADMIN@DGOP.LOCAL ', ' Exact Password ');
    const request = http.expectOne('/api/auth/login');
    expect(request.request.body).toEqual({ email: user.email, password: ' Exact Password ' });
    request.flush({ user });
    await Promise.resolve();
    expect(auth.isAuthenticated()).toBe(false);
    http.expectOne('/api/auth/session').flush(user);
    await Promise.resolve();
    http.expectOne('/api/ai/capabilities').flush(noAi);
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
    await Promise.resolve();
    http.expectOne('/api/ai/capabilities').flush(noAi);
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

  it('fails AI capabilities closed without discarding a retained login', async () => {
    const promise=auth.login(user.email,'test-password');
    http.expectOne('/api/auth/login').flush({user});await Promise.resolve();
    http.expectOne('/api/auth/session').flush({...user,permissions:['*']});await Promise.resolve();
    http.expectOne('/api/ai/capabilities').flush({message:'Unavailable'},{status:503,statusText:'Service Unavailable'});
    await promise;
    expect(auth.isAuthenticated()).toBe(true);expect(auth.aiCapabilities()).toBe(null);
    expect(auth.hasAiScreen('review')).toBe(false);expect(auth.hasPermission('case.approve.aiuc')).toBe(false);
    expect(auth.hasPermission('users.edit')).toBe(true);
  });

  it('uses server read oversight instead of platform wildcard permissions for AI decisions', async () => {
    const administrator={...user,permissions:['*']};
    const capabilities:AiCapabilities={...noAi,administratorOversight:true,readMode:'governance',permissions:['case.view.aiuc.all','case.view.airs.all','dashboard.view.aiuc','dashboard.view.airs'],screens:{useCases:true,risks:true,review:true,reviewOperations:true,dashboard:true,migration:true}};
    const promise=auth.bootstrap();http.expectOne('/api/auth/session').flush(administrator);await Promise.resolve();
    http.expectOne('/api/ai/capabilities').flush(capabilities);await promise;
    expect(auth.hasAiScreen('review')).toBe(true);expect(auth.hasPermission('case.view.aiuc.all')).toBe(true);
    for(const purpose of ['case.approve.aiuc','case.approve.airs','airs.risk.accept.high','refdata.publish','aiuc.asset.approve'])expect(auth.hasPermission(purpose)).toBe(false);
    auth.clearSession();expect(auth.aiCapabilities()).toBe(null);expect(auth.hasAiScreen('review')).toBe(false);
  });

  it('times out a stalled capability handshake while preserving the cookie session', async () => {
    vi.useFakeTimers();const promise=auth.bootstrap();http.expectOne('/api/auth/session').flush(user);await Promise.resolve();
    const request=http.expectOne('/api/ai/capabilities');await vi.advanceTimersByTimeAsync(10001);await promise;
    expect(request.cancelled).toBe(true);expect(auth.isAuthenticated()).toBe(true);expect(auth.hasAiScreen('dashboard')).toBe(false);
  });

  it('does not restore old capabilities after the session has been cleared', async () => {
    const promise=auth.bootstrap();http.expectOne('/api/auth/session').flush(user);await Promise.resolve();
    const request=http.expectOne('/api/ai/capabilities');auth.clearSession();request.flush({...noAi,permissions:['case.approve.aiuc']});await promise;
    expect(auth.isAuthenticated()).toBe(false);expect(auth.aiCapabilities()).toBe(null);expect(auth.hasAiPermission('case.approve.aiuc')).toBe(false);
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
