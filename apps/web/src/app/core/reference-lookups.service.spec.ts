import {provideHttpClient} from '@angular/common/http';
import {HttpTestingController,provideHttpClientTesting} from '@angular/common/http/testing';
import {TestBed} from '@angular/core/testing';
import {AuthService} from './auth.service';
import {ReferenceLookupsService} from './reference-lookups.service';

describe('Reference lookup permission boundaries',()=>{
 let permissions:Set<string>,http:HttpTestingController,service:ReferenceLookupsService;
 beforeEach(()=>{permissions=new Set();TestBed.configureTestingModule({providers:[provideHttpClient(),provideHttpClientTesting(),{provide:AuthService,useValue:{hasPermission:(permission:string)=>permissions.has(permission)}}]});http=TestBed.inject(HttpTestingController);service=TestBed.inject(ReferenceLookupsService);});
 afterEach(()=>http.verify());
 it('operational readers do not fetch forbidden directory or administration lists',()=>{
  permissions.add('data_assets.view');let result:unknown;service.list('people.view','/api/people').subscribe(rows=>result=rows);expect(result).toEqual([]);http.expectNone('/api/people');
 });
 it('the current specific grant permits its list and revoked grants stop later reads',()=>{
  permissions.add('people.view');let result:unknown;service.list('people.view','/api/people').subscribe(rows=>result=rows);http.expectOne('/api/people').flush([{id:'person'}]);expect(result).toEqual([{id:'person'}]);permissions.clear();service.list('people.view','/api/people').subscribe(rows=>result=rows);expect(result).toEqual([]);http.expectNone('/api/people');
 });
 it('a genuine permitted lookup failure propagates for the screen to handle',()=>{
  permissions.add('people.view');let failed=false;service.list('people.view','/api/people').subscribe({error:()=>failed=true});http.expectOne('/api/people').flush({}, {status:503,statusText:'Unavailable'});expect(failed).toBe(true);
 });
});
