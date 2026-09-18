import { ChangeDetectionStrategy, Component, EventEmitter, inject, OnInit, Output, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { HttpClient } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';
import { SelectModule } from 'primeng/select';
import { TextareaModule } from 'primeng/textarea';
import { RippleModule } from 'primeng/ripple';
import { I18nService } from '../../../core/i18n.service';
import { ToastService } from '../../../shared/toast.service';
import { AppIcon } from '../../../shared/app-icon';
import { AiRiskLibrary, LibraryRow } from './ai-risk-library';

@Component({
  selector: 'app-ai-risk-initiation',
  standalone: true,
  imports: [FormsModule, SelectModule, TextareaModule, RippleModule, AppIcon, AiRiskLibrary],
  template: `
    <section class="risk-create-card">
      <header class="risk-create-head">
        <span class="risk-create-icon"><app-icon name="shield" /></span>
        <div><span class="eyebrow">{{ t('aiRisk.stage.1') }}</span><h2>{{ t('aiInitiation.title') }}</h2></div>
      </header>
      <p class="risk-create-help">{{ t('aiInitiation.help') }}</p>
      @if (state() === 'loading') {
        <div class="risk-create-state" role="status">{{ t('crud.loading') }}</div>
      } @else if (state() === 'error') {
        <div class="risk-create-state"><p>{{ t('aiInitiation.error') }}</p><button type="button" class="ds-btn ds-btn--ghost" pRipple (click)="load()">{{ t('crud.retry') }}</button></div>
      } @else if (context().canCreate) {
        <fieldset class="risk-create-form" [disabled]="working()">
          <label class="risk-form-field">
            <span>{{ t('aiInitiation.useCase') }}</span>
            <p-select [options]="parentOptions()" optionLabel="label" optionValue="value" [filter]="true" [showClear]="true" appendTo="body" [placeholder]="t('aiuc.select')" [ngModel]="useCaseId() || null" [ngModelOptions]="{standalone:true}" (ngModelChange)="useCaseId.set($event || '')" [ariaLabel]="t('aiInitiation.useCase')" />
          </label>
          <section class="library-choice" [class.library-choice--selected]="library()">
            @if (library(); as selectedLibrary) {
              <div><small>{{ t('aiInitiation.librarySource') }}</small><strong>{{ selectedLibrary.libraryRef }} · {{ t('aiDashboard.round') }} {{ selectedLibrary.round }}</strong></div>
              <button type="button" class="ds-btn ds-btn--ghost btn-sm" pRipple (click)="library.set(null)">{{ t('aiInitiation.manual') }}</button>
            } @else {
              <div><small>{{ t('aiInitiation.librarySource') }}</small><strong>{{ t('aiRisk.libraryOptional') }}</strong></div>
              <button type="button" class="ds-btn ds-btn--ghost btn-sm" pRipple (click)="showLibrary.set(!showLibrary())">{{ t('aiLibrary.title') }}</button>
            }
          </section>
          <label class="risk-form-field">
            <span>{{ t('aiReview.justification') }}</span>
            <textarea pTextarea rows="3" maxlength="5000" [ngModel]="justification()" [ngModelOptions]="{standalone:true}" (ngModelChange)="justification.set($event)" [placeholder]="t('aiRisk.createReasonHint')"></textarea>
          </label>
          <button type="button" class="ds-btn ds-btn--primary risk-create-submit" pRipple [disabled]="!useCaseId() || !justification().trim() || working()" (click)="create()">{{ t('aiInitiation.create') }}</button>
        </fieldset>
      } @else {
        <div class="review-gate-note"><app-icon name="info" /><span>{{ t('aiInitiation.readOnly') }}</span></div>
      }
    </section>
    @if (showLibrary()) { <div class="risk-library-picker"><app-ai-risk-library [allowChoose]="context().canCreate" (chosen)="choose($event)" /></div> }
  `,
  styleUrls: ['../ai-review/ai-review.scss', './ai-risks.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AiRiskInitiation implements OnInit {
  @Output() created = new EventEmitter<string>();
  private readonly http = inject(HttpClient);
  private readonly i18n = inject(I18nService);
  private readonly toast = inject(ToastService);
  protected readonly context = signal<{ canCreate: boolean; parents: Array<{ id: string; useCaseRef: string; name: string }> }>({ canCreate: false, parents: [] });
  protected readonly state = signal<'loading' | 'ok' | 'error'>('loading');
  protected readonly working = signal(false);
  protected readonly showLibrary = signal(false);
  protected readonly library = signal<LibraryRow | null>(null);
  protected readonly useCaseId = signal('');
  protected readonly justification = signal('');
  private requestKey = '';
  private requestSignature = '';

  protected t(key: string): string { return this.i18n.t(key); }
  protected parentOptions() { return this.context().parents.map(parent => ({ value: parent.id, label: `${parent.useCaseRef} · ${parent.name}` })); }
  ngOnInit(): void { void this.load(); }
  protected choose(row: LibraryRow): void { if (this.context().canCreate) { this.library.set(row); this.showLibrary.set(false); } }
  protected async load(): Promise<void> {
    this.state.set('loading');
    try {
      this.context.set(await firstValueFrom(this.http.get<{ canCreate: boolean; parents: Array<{ id: string; useCaseRef: string; name: string }> }>('/api/ai/risks/initiation')));
      this.state.set('ok');
    } catch (error) { this.state.set('error'); this.toast.errorFrom(error, this.t('aiInitiation.error')); }
  }
  protected async create(): Promise<void> {
    if (!this.context().canCreate || this.working()) return;
    this.working.set(true);
    const signature = JSON.stringify([this.useCaseId(), this.library()?.versionId ?? null, this.justification()]);
    if (signature !== this.requestSignature) { this.requestKey = crypto.randomUUID(); this.requestSignature = signature; }
    try {
      const result = await firstValueFrom(this.http.post<{ id: string }>('/api/ai/risks', { useCaseId: this.useCaseId(), libraryVersionId: this.library()?.versionId, initiationKey: this.requestKey, justification: this.justification() }));
      this.requestSignature = ''; this.justification.set(''); this.library.set(null);
      this.toast.success(this.t('aiInitiation.created')); this.created.emit(result.id);
    } catch (error) { this.toast.errorFrom(error, this.t('aiInitiation.error')); }
    finally { this.working.set(false); }
  }
}
