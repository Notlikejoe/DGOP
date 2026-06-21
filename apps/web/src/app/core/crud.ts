import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';

/** Minimal typed CRUD client over a REST resource base (e.g. /api/systems). */
export class CrudClient<T extends { id: string }> {
  constructor(
    private readonly http: HttpClient,
    private readonly base: string,
  ) {}

  list(): Observable<T[]> {
    return this.http.get<T[]>(this.base);
  }

  create(body: Partial<T>): Observable<T> {
    return this.http.post<T>(this.base, body);
  }

  update(id: string, body: Partial<T>): Observable<T> {
    return this.http.patch<T>(`${this.base}/${id}`, body);
  }

  remove(id: string): Observable<{ success: boolean }> {
    return this.http.delete<{ success: boolean }>(`${this.base}/${id}`);
  }
}
