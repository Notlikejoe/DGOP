import { ChangeDetectionStrategy, Component, computed, inject, OnInit, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { HttpClient } from '@angular/common/http';
import { I18nService } from '../../../core/i18n.service';
import { AuthService } from '../../../core/auth.service';
import { NdiDomainCount } from './ndi.types';

@Component({
  selector: 'app-ndi-hub',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink],
  templateUrl: './ndi-hub.html',
  styleUrl: './ndi.scss',
})
export class NdiHubPage implements OnInit {
  private readonly http = inject(HttpClient);
  protected readonly i18n = inject(I18nService);
  private readonly auth = inject(AuthService);

  protected get canScore(): boolean { return this.auth.hasPermission('ndi_scoring.view'); }

  protected readonly state = signal<'loading' | 'ok' | 'error'>('loading');
  protected readonly domains = signal<NdiDomainCount[]>([]);

  protected readonly totalSpecs = computed(() =>
    this.domains().reduce((sum, d) => sum + d.specCount, 0),
  );
  protected readonly coveredDomains = computed(() =>
    this.domains().filter((d) => d.specCount > 0).length,
  );

  ngOnInit(): void {
    this.load();
  }

  protected load(): void {
    this.state.set('loading');
    this.http.get<NdiDomainCount[]>('/api/ndi/domains').subscribe({
      next: (d) => {
        this.domains.set(d);
        this.state.set('ok');
      },
      error: () => this.state.set('error'),
    });
  }

  protected t(key: string): string {
    return this.i18n.t(key);
  }
  protected name(o: { nameEn: string; nameAr: string }): string {
    return this.i18n.lang() === 'ar' ? o.nameAr : o.nameEn;
  }
}
