import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { I18nService } from '../core/i18n.service';

@Component({
  selector: 'app-brand-logo',
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './brand-logo.html',
  styles: [`
    :host {
      display: block;
      min-width: 0;
      max-width: 100%;
      padding: 0.375rem;
      background: #f6fbfc;
      border: 1px solid #dbe8ed;
      border-radius: 0.625rem;
      box-sizing: border-box;
      direction: ltr;
    }
    img { display: block; width: 100%; height: auto; object-fit: contain; }
  `],
})
export class BrandLogo {
  protected readonly i18n = inject(I18nService);
}
