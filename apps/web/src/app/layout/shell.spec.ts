import { Component, OnDestroy, OnInit, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { HttpClient, provideHttpClient, withInterceptors } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { provideRouter, Router } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { TestBed } from '@angular/core/testing';
import { vi } from 'vitest';
import { AuthService } from '../core/auth.service';
import { UserProfile } from '../core/auth.models';
import { authInterceptor } from '../core/auth.interceptor';
import { I18nService } from '../core/i18n.service';
import { Shell } from './shell';

let mounts=0,destroys=0;
@Component({imports:[FormsModule],template:'<input aria-label="Draft" [(ngModel)]="draft"><span class="records">{{ records() }}</span>'})
class PageProbe implements OnInit,OnDestroy {
  private readonly http=inject(HttpClient);
  draft='';readonly records=signal('');
  constructor(){mounts++;}
  ngOnInit(){this.http.get<string[]>('/api/assets').subscribe({next:r=>this.records.set(r.join(',')),error:()=>{}});}
  ngOnDestroy(){destroys++;}
}
@Component({template:'<h1>About</h1>'})class AboutProbe{}
describe('Live protected-page boundary',()=>{
  let auth:AuthService,http:HttpTestingController;
  const profile:UserProfile={id:'owner',email:'owner@local',displayName:'Owner',isActive:true,lastLoginAt:null,roles:[],permissions:['data_assets.view'],accessRevision:'finance',scopes:{orgUnits:['finance'],domains:['finance'],maxClassRank:2}};
  beforeEach(async()=>{
    vi.stubGlobal('matchMedia', () => ({matches:false,addEventListener:()=>{},removeEventListener:()=>{}}));
    mounts=destroys=0;
    TestBed.configureTestingModule({providers:[provideHttpClient(withInterceptors([authInterceptor])),provideHttpClientTesting(),
      provideRouter([{path:'',component:Shell,children:[{path:'assets',component:PageProbe},{path:'about',component:AboutProbe}]}]),
      {provide:I18nService,useValue:{lang:signal('en'),t:(k:string)=>k}},
    ]});auth=TestBed.inject(AuthService);http=TestBed.inject(HttpTestingController);
    const loaded=auth.bootstrap();http.expectOne('/api/auth/session').flush(profile);await loaded;
  });
  afterEach(()=>{auth.clearSession();http.verify();vi.unstubAllGlobals();});
  it('recreates an open page after scope changes and cancels its old data request',async()=>{
    const harness=await RouterTestingHarness.create('/assets');const old=http.expectOne('/api/assets');
    const input=harness.routeNativeElement!.querySelector<HTMLInputElement>('input[aria-label=Draft]')!;input.value='unsaved';input.dispatchEvent(new Event('input'));
    const refresh=auth.refreshAccess();http.expectOne('/api/auth/session').flush({...profile,accessRevision:'hr',scopes:{orgUnits:['hr'],domains:['hr'],maxClassRank:2}});await refresh;
    harness.detectChanges();await harness.fixture.whenStable();harness.detectChanges();
    expect(old.cancelled).toBe(true);expect(mounts).toBe(2);expect(destroys).toBe(1);
    http.expectOne('/api/assets').flush(['HR']);harness.detectChanges();
    expect(harness.routeNativeElement!.querySelector<HTMLInputElement>('input[aria-label=Draft]')!.value).toBe('');
    expect(harness.routeNativeElement!.textContent).toContain('access.live.updated');
    expect(harness.routeNativeElement!.textContent).toContain('HR');
  });
  it('removes a revoked open page and explains the return to About',async()=>{
    const harness=await RouterTestingHarness.create('/assets');http.expectOne('/api/assets').flush(['Finance']);
    const refresh=auth.refreshAccess();http.expectOne('/api/auth/session').flush({...profile,permissions:[],accessRevision:'removed'});await refresh;
    harness.detectChanges();await harness.fixture.whenStable();harness.detectChanges();
    expect(TestBed.inject(Router).url).toBe('/about');expect(destroys).toBe(1);
    expect(harness.routeNativeElement!.textContent).toContain('access.live.removed');
    expect(harness.routeNativeElement!.textContent).not.toContain('Finance');
  });
  it('covers protected content during unverified access and preserves the page on unchanged recovery',async()=>{
    const harness=await RouterTestingHarness.create('/assets');http.expectOne('/api/assets').flush(['Finance']);harness.detectChanges();
    auth.accessStatus.set('unavailable');harness.detectChanges();
    expect(harness.routeNativeElement!.querySelector('.access-screen-cover')).not.toBeNull();
    expect(harness.routeNativeElement!.querySelector('.shell')!.hasAttribute('inert')).toBe(true);
    expect((harness.routeNativeElement!.querySelector('#main-content > div') as HTMLElement).hidden).toBe(true);
    const outside=document.createElement('button');document.body.appendChild(outside);outside.focus();
    expect(document.activeElement?.closest('.access-screen-cover')).not.toBeNull();outside.remove();
    const refresh=auth.refreshAccess();http.expectOne('/api/auth/session').flush(profile);await refresh;harness.detectChanges();
    expect(harness.routeNativeElement!.querySelector('.access-screen-cover')).toBeNull();expect(mounts).toBe(1);http.expectNone('/api/assets');
  });
  it('reopens results when typing into search that retained focus during an access change',async()=>{
    const enabled=auth.refreshAccess();http.expectOne('/api/auth/session').flush({...profile,permissions:[...profile.permissions,'search.view'],accessRevision:'search-finance'});await enabled;
    const harness=await RouterTestingHarness.create('/assets');http.expectOne('/api/assets').flush(['Finance']);harness.detectChanges();
    const input=harness.routeNativeElement!.querySelector<HTMLInputElement>('.topbar-search input')!;
    input.focus();input.value='Finance';input.dispatchEvent(new Event('input'));harness.detectChanges();
    expect(harness.routeNativeElement!.querySelector('.topbar-search__panel')).not.toBeNull();
    const refresh=auth.refreshAccess();http.expectOne('/api/auth/session').flush({...profile,permissions:[...profile.permissions,'search.view'],accessRevision:'search-hr',scopes:{orgUnits:['hr'],domains:['hr'],maxClassRank:2}});await refresh;
    harness.detectChanges();await harness.fixture.whenStable();http.expectOne('/api/assets').flush(['HR']);harness.detectChanges();
    expect(input.value).toBe('');expect(document.activeElement).toBe(input);
    input.value='HR';input.dispatchEvent(new Event('input'));harness.detectChanges();
    expect(harness.routeNativeElement!.querySelector('.topbar-search__panel')).not.toBeNull();
    input.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape'}));harness.detectChanges();
  });
});
