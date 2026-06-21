import { ChangeDetectionStrategy, Component, inject, OnInit } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { I18nService } from './core/i18n.service';
import { ThemeService } from './core/theme.service';
import { ToastHost } from './shared/toast';
import { ConfirmDialog } from './shared/confirm-dialog';

@Component({
  selector: 'app-root',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterOutlet, ToastHost, ConfirmDialog],
  template: '<router-outlet /><app-toast /><app-confirm-dialog />',
})
export class App implements OnInit {
  private readonly theme = inject(ThemeService);
  private readonly i18n = inject(I18nService);

  ngOnInit(): void {
    this.theme.init();
    this.i18n.init();
  }
}
