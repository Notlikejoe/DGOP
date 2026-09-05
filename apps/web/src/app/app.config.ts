import {
  ApplicationConfig,
  inject,
  provideAppInitializer,
  provideBrowserGlobalErrorListeners,
} from '@angular/core';
import { provideHttpClient, withFetch, withInterceptors } from '@angular/common/http';
import { provideRouter } from '@angular/router';
import { providePrimeNG } from 'primeng/config';

import { routes } from './app.routes';
import { authInterceptor } from './core/auth.interceptor';
import { AuthService } from './core/auth.service';
import { I18nService } from './core/i18n.service';
import { dgopPrimeNgConfig } from './core/primeng.config';
import { primeUiLicense } from './core/primeui-license.local';

export const appConfig: ApplicationConfig = {
  providers: [
    provideBrowserGlobalErrorListeners(),
    provideRouter(routes),
    provideHttpClient(withFetch(), withInterceptors([authInterceptor])),
    providePrimeNG({ ...dgopPrimeNgConfig, license: primeUiLicense }),
    provideAppInitializer(() => inject(I18nService).ready()),
    provideAppInitializer(() => inject(AuthService).bootstrap()),
  ],
};
