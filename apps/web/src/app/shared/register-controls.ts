import {
  ChangeDetectionStrategy,
  Component,
  effect,
  inject,
  input,
  output,
  signal,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { I18nService } from '../core/i18n.service';
import { Pager } from './pager';

@Component({
  selector: 'app-register-controls',
  imports: [FormsModule, Pager],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `<form
      (ngSubmit)="submit()"
      class="register-search"
      [attr.aria-label]="registerName()"
    >
      <label
        >{{ i18n.lang() === 'ar' ? 'بحث في السجل' : 'Search register' }} —
        {{ registerName() }}
        <input
          name="search"
          maxlength="200"
          [ngModel]="draft()"
          (ngModelChange)="draft.set($event)"
        /> </label
      ><button type="submit" class="ds-btn ds-btn--ghost" [disabled]="busy()">
        {{ i18n.lang() === 'ar' ? 'بحث' : 'Search' }}
      </button>
    </form>
    <app-pager
      [page]="page()"
      [pageSize]="pageSize()"
      [total]="total()"
      [totalPages]="pages()"
      (pageChange)="queryChange.emit({ page: $event, search: applied() })"
    />`,
  styles: [
    `
      :host {
        display: block;
        min-width: 0;
        width: 100%;
      }
      .register-search {
        display: flex;
        gap: 0.5rem;
        align-items: end;
        flex-wrap: wrap;
        margin: 0.75rem 0;
      }
      .register-search label {
        display: grid;
        gap: 0.25rem;
        flex: 1;
        min-width: 10rem;
      }
    `,
  ],
})
export class RegisterControls {
  protected readonly i18n = inject(I18nService);
  readonly page = input(1);
  readonly pageSize = input(25);
  readonly total = input(0);
  readonly busy = input(false);
  readonly registerName = input('');
  readonly search = input('');
  constructor() {
    effect(() => {
      const search = this.search();
      this.draft.set(search);
      this.applied.set(search);
    });
  }
  readonly queryChange = output<{ page: number; search: string }>();
  protected readonly draft = signal('');
  protected readonly applied = signal('');
  protected submit() {
    this.applied.set(this.draft());
    this.queryChange.emit({ page: 1, search: this.applied() });
  }
  protected pages() {
    return Math.max(1, Math.ceil(this.total() / this.pageSize()));
  }
}
