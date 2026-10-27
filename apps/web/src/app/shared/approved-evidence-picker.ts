import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  inject,
  input,
  OnInit,
  output,
  signal,
} from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { FormsModule } from '@angular/forms';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { Subscription } from 'rxjs';
import { AuthService } from '../core/auth.service';
import { I18nService } from '../core/i18n.service';
import { Pager } from './pager';
interface ProofOption {
  id: string;
  title: string;
  fileAvailability: string;
}
@Component({
  selector: 'app-approved-evidence-picker',
  imports: [FormsModule, Pager],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `<div class="proof-picker">
    <label
      >{{ ar() ? 'الدليل المعتمد' : 'Approved evidence' }}
      <input
        name="proof-search"
        maxlength="200"
        [ngModel]="search()"
        (ngModelChange)="search.set($event)"
        [placeholder]="ar() ? 'ابحث بعنوان الوثيقة' : 'Search by document title'"
      /> </label
    ><button type="button" class="ds-btn ds-btn--ghost" (click)="load(1)" [disabled]="busy()">
      {{ ar() ? 'بحث' : 'Search' }}
    </button>
    <select
      [attr.aria-label]="ar() ? 'الدليل المعتمد' : 'Approved evidence'"
      name="approved-evidence"
      [ngModel]="selectedId()"
      (ngModelChange)="selectedChange.emit($event)"
      [disabled]="busy() || !allowed()"
    >
      <option value="">
        {{ ar() ? 'اختر الوثيقة الداعمة' : 'Choose the supporting document' }}
      </option>
      @for (row of rows(); track row.id) {
        <option [value]="row.id" [disabled]="row.fileAvailability !== 'available'">
          {{ row.title
          }}{{
            row.fileAvailability !== 'available'
              ? ar()
                ? ' — الملف غير متاح'
                : ' — file unavailable'
              : ''
          }}
        </option>
      }
    </select>
    @if (error()) {
      <p role="status">{{ error() }}</p>
    }
    <app-pager
      [page]="page()"
      [pageSize]="25"
      [total]="total()"
      [totalPages]="pages()"
      (pageChange)="load($event)"
    />
  </div>`,
  styles: [
    `
      :host {
        display: block;
        min-width: 0;
        max-width: 100%;
        flex-basis: 100%;
      }
      .proof-picker {
        display: grid;
        gap: 0.5rem;
        min-width: 0;
      }
      .proof-picker label {
        display: grid;
        gap: 0.25rem;
      }
      .proof-picker select {
        max-width: 100%;
      }
    `,
  ],
})
export class ApprovedEvidencePicker implements OnInit {
  private readonly http = inject(HttpClient);
  private readonly auth = inject(AuthService);
  private readonly destroy = inject(DestroyRef);
  private readonly i18n = inject(I18nService);
  readonly selectedId = input('');
  readonly selectedChange = output<string>();
  protected readonly rows = signal<ProofOption[]>([]);
  protected readonly page = signal(1);
  protected readonly total = signal(0);
  protected readonly search = signal('');
  protected readonly busy = signal(false);
  protected readonly error = signal('');
  private request?: Subscription;
  private revision = 0;
  protected ar() {
    return this.i18n.lang() === 'ar';
  }
  protected allowed() {
    return this.auth.hasPermission('evidence.view');
  }
  protected pages() {
    return Math.max(1, Math.ceil(this.total() / 25));
  }
  ngOnInit() {
    this.load(1);
  }
  protected load(page: number) {
    if (!this.allowed()) {
      this.error.set(
        this.ar()
          ? 'يتطلب اختيار الدليل صلاحية عرض الأدلة.'
          : 'Selecting proof requires evidence viewing access.',
      );
      return;
    }
    this.request?.unsubscribe();
    const revision = ++this.revision;
    this.busy.set(true);
    this.error.set('');
    const params = new HttpParams()
      .set('page', page)
      .set('pageSize', 25)
      .set('search', this.search());
    this.request = this.http
      .get<{ data: ProofOption[]; total: number; page: number }>('/api/evidence/approved-options', {
        params,
      })
      .pipe(takeUntilDestroyed(this.destroy))
      .subscribe({
        next: (result) => {
          if (revision !== this.revision) return;
          this.rows.set(result.data);
          this.total.set(result.total);
          this.page.set(result.page);
          this.busy.set(false);
        },
        error: () => {
          if (revision !== this.revision) return;
          this.rows.set([]);
          this.busy.set(false);
          this.error.set(
            this.ar() ? 'تعذر تحميل الأدلة. أعد المحاولة.' : 'Could not load evidence. Try again.',
          );
        },
      });
  }
}
