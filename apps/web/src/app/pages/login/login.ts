import { ChangeDetectionStrategy, Component, inject, isDevMode, OnInit, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import { AuthService } from '../../core/auth.service';
import { I18nService } from '../../core/i18n.service';
import { ThemeService } from '../../core/theme.service';
import { ApiService, HealthResponse } from '../../core/api.service';

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
    this.api.health().subscribe({
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
    return this.health()?.environment === 'development'
      ? this.t('login.signalDevelopment')
      : this.t('login.signalProduction');
  }

  protected async submit(): Promise<void> {
    if (this.loading()) return;
    this.error.set('');
    this.loading.set(true);
    try {
      await this.auth.login(this.email().trim(), this.password());
      const returnUrl = this.route.snapshot.queryParamMap.get('returnUrl') ?? '/dashboard';
      void this.router.navigateByUrl(returnUrl);
    } catch {
      this.error.set(this.t('login.invalid'));
    } finally {
      this.loading.set(false);
    }
  }

  protected t(key: string): string {
    return this.i18n.t(key);
  }
}
