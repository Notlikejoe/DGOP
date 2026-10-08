import { ChangeDetectionStrategy, Component, effect, inject, signal } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { firstValueFrom, timeout } from 'rxjs';
import { AuthService } from '../core/auth.service';
import { I18nService } from '../core/i18n.service';

@Component({
  selector: 'app-demo-banner',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `@if (enabled()) { <aside role="note" class="demo-banner" [attr.dir]="i18n.dir()">{{ i18n.lang() === 'ar' ? 'عرض تجريبي · بيانات اصطناعية · الوصول والبريد الإلكتروني محاكاة محلية · ليس إثبات امتثال' : 'Demonstration · Synthetic data · Access and email use local simulations · This is not a compliance claim' }}</aside> }`,
  styles: [`.demo-banner { padding: .55rem 1rem; background: #fff4cf; color: #614b13; border-bottom: 1px solid #e8dba6; font-size: .85rem; text-align: center; line-height: 1.5; }`],
})
export class DemoBanner {
  private readonly http = inject(HttpClient);
  private readonly auth = inject(AuthService);
  readonly i18n = inject(I18nService);
  readonly enabled = signal(false);
  private revision = 0;
  constructor() {
    effect(() => {
      const user = this.auth.currentUser(), revision = ++this.revision;
      this.enabled.set(false);
      if (!user) return;
      void firstValueFrom(this.http.get<{ demoScenarioAvailable: boolean }>('/api/ndi/scoring/context').pipe(timeout(10000)))
        .then(context => { if (revision === this.revision) this.enabled.set(context.demoScenarioAvailable === true); })
        .catch(() => { if (revision === this.revision) this.enabled.set(false); });
    });
  }
}
