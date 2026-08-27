import { ChangeDetectionStrategy, Component, inject, isDevMode, OnInit, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import { AuthService } from '../../core/auth.service';
import { I18nService } from '../../core/i18n.service';
import { ThemeService } from '../../core/theme.service';
import { ApiService, HealthResponse } from '../../core/api.service';
import { timeout } from 'rxjs';
import { loginErrorKey, loginReturnUrl } from './login.logic';

@Component({
  selector: 'app-login',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule],
  templateUrl: './login.html',
  styleUrl: './login.scss',
})
export class Login implements OnInit {
  protected readonly auth = inject(AuthService);
  protected readonly i18n = inject(I18nService);
  protected readonly theme = inject(ThemeService);
  private readonly api = inject(ApiService);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);

  protected email = signal('');
  protected password = signal('');
  protected loading = signal(false);
  protected error = signal('');
  protected readonly health = signal<HealthResponse | null>(null);
  protected readonly healthState = signal<'checking' | 'healthy' | 'unavailable'>('checking');
  protected readonly developmentBuild = isDevMode();

  ngOnInit(): void {
    this.checkHealth();
    if (this.auth.isAuthenticated()) {
      void this.router.navigate(['/dashboard']);
    }
  }

  private checkHealth(): void {
    this.api.health().pipe(timeout(10_000)).subscribe({
      next: (health) => {
        this.health.set(health);
        this.healthState.set(
          health.status === 'ok' && health.database.status === 'up' ? 'healthy' : 'unavailable',
        );
      },
      error: () => this.healthState.set('unavailable'),
    });
  }

  protected serviceStatus(): string {
    if (this.healthState() === 'checking') return this.t('login.signalChecking');
    return this.health()?.status === 'ok'
      ? this.t('login.signalOnline')
      : this.t('login.signalUnavailable');
  }

  protected databaseStatus(): string {
    if (this.healthState() === 'checking') return this.t('login.signalChecking');
    return this.health()?.database.status === 'up'
      ? this.t('login.signalConnected')
      : this.t('login.signalUnavailable');
  }

  protected environmentStatus(): string {
    if (this.healthState() === 'checking') return this.t('login.signalChecking');
    if (this.healthState() === 'unavailable') return this.t('login.signalUnknown');
    const environment = this.health()?.environment?.trim().toLowerCase();
    if (environment === 'development' || environment === 'dev') return this.t('login.signalDevelopment');
    if (environment === 'test' || environment === 'testing') return this.t('login.signalTest');
    if (environment === 'uat') return this.t('login.signalUat');
    if (environment === 'preproduction' || environment === 'pre-production' || environment === 'preprod' || environment === 'staging') {
      return this.t('login.signalPreproduction');
    }
    if (environment === 'production' || environment === 'prod') return this.t('login.signalProduction');
    return this.t('login.signalUnknown');
  }

  protected async submit(): Promise<void> {
    if (this.loading()) return;
    this.error.set('');
    this.loading.set(true);
    try {
      await this.auth.login(this.email().trim(), this.password());
    } catch (error: unknown) {
      this.error.set(this.t(loginErrorKey(error)));
      this.checkHealth();
      return;
    } finally {
      this.loading.set(false);
    }
    const returnUrl = loginReturnUrl(this.route.snapshot.queryParamMap.get('returnUrl'));
    try {
      if (!await this.router.navigateByUrl(returnUrl)) this.error.set(this.t('login.navigationFailed'));
    } catch {
      this.error.set(this.t('login.navigationFailed'));
    }
  }

  protected t(key: string): string {
    return this.i18n.t(key);
  }
}
