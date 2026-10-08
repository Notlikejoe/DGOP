import {inject,Injectable} from '@angular/core';
import {HttpClient} from '@angular/common/http';
import {Observable,of} from 'rxjs';
import {AuthService} from './auth.service';

@Injectable({providedIn:'root'})
export class ReferenceLookupsService {
 private readonly auth=inject(AuthService);
 private readonly http=inject(HttpClient);
 list<T>(permission:string,url:string):Observable<T[]> {
  return this.auth.hasPermission(permission)?this.http.get<T[]>(url):of([]);
 }
}
