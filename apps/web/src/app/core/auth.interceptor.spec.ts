import { HttpClient, provideHttpClient, withInterceptors } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';
import { vi } from 'vitest';
import { Subject } from 'rxjs';
import { AccessChangedError, AccessUnavailableError } from './access-errors';
import { AuthService } from './auth.service';
import { authInterceptor } from './auth.interceptor';

describe('Permission mutation refresh interceptor', () => {
  let client: HttpClient, http: HttpTestingController;
  let generation: number, writable: boolean, invalidated: Subject<void>;
  let auth: {sessionEpoch:number;notifyAccessChanged:ReturnType<typeof vi.fn>;clearSession:ReturnType<typeof vi.fn>;accessGeneration:()=>number;canWrite:()=>boolean;accessInvalidated$:Subject<void>};
  beforeEach(() => {
    generation=1;writable=true;invalidated=new Subject<void>();
    auth = {sessionEpoch:1,notifyAccessChanged:vi.fn(),clearSession:vi.fn(),accessGeneration:()=>generation,canWrite:()=>writable,accessInvalidated$:invalidated};
    TestBed.configureTestingModule({providers:[provideHttpClient(withInterceptors([authInterceptor])),provideHttpClientTesting(),provideRouter([]),{provide:AuthService,useValue:auth}]});
    client = TestBed.inject(HttpClient); http = TestBed.inject(HttpTestingController);
    vi.spyOn(TestBed.inject(Router),'navigate').mockResolvedValue(true);
  });
  afterEach(() => { http.verify(); vi.restoreAllMocks(); });
  it('refreshes after successful role, scope and membership saves', () => {
    for (const route of ['/api/roles/id/permissions','/api/roles/id/scopes','/api/users/id/roles']) {
      client.put(route,{}).subscribe(); const r=http.expectOne(route);
      expect(r.request.withCredentials).toBe(true); r.flush({});
    }
    expect(auth.notifyAccessChanged).toHaveBeenCalledTimes(3);
    expect(auth.notifyAccessChanged).toHaveBeenCalledWith(1);
  });
  it('does not refresh failed saves or unrelated reads and writes', () => {
    client.patch('/api/roles/id',{}).subscribe({error:()=>{}});
    http.expectOne('/api/roles/id').flush({}, {status:409,statusText:'Conflict'});
    client.get('/api/users').subscribe(); http.expectOne('/api/users').flush([]);
    client.post('/api/assets',{}).subscribe(); http.expectOne('/api/assets').flush({});
    expect(auth.notifyAccessChanged).not.toHaveBeenCalled();
  });
  it('ignores unauthorized responses belonging to an older login', () => {
    client.get('/api/assets').subscribe({error:()=>{}}); const old=http.expectOne('/api/assets');
    auth.sessionEpoch=2; old.flush({}, {status:401,statusText:'Unauthorized'});
    expect(auth.clearSession).not.toHaveBeenCalled();
  });
  it('clears the current login for an authoritative protected API 401', () => {
    client.get('/api/assets').subscribe({error:()=>{}});
    http.expectOne('/api/assets').flush({}, {status:401,statusText:'Unauthorized'});
    expect(auth.clearSession).toHaveBeenCalledOnce();
  });
  it('cancels old reads when their access snapshot is replaced', () => {
    let error:unknown;
    client.get('/api/assets').subscribe({error:e=>error=e});const request=http.expectOne('/api/assets');
    ++generation;invalidated.next();
    expect(request.cancelled).toBe(true);expect(error).toBeInstanceOf(AccessChangedError);
  });
  it('blocks new writes while access is unverified, without sending or retrying them', () => {
    writable=false;let error:unknown;
    client.post('/api/assets',{}).subscribe({error:e=>error=e});
    http.expectNone('/api/assets');expect(error).toBeInstanceOf(AccessUnavailableError);
  });
  it('does not apply a late write response or replay that write under newer access', () => {
    let error:unknown;client.post('/api/assets',{}).subscribe({error:e=>error=e});const request=http.expectOne('/api/assets');
    ++generation;request.flush({id:'old'});
    expect(error).toBeInstanceOf(AccessChangedError);http.expectNone('/api/assets');
  });
});
