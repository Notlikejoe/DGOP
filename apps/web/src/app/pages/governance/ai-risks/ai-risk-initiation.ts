import { ChangeDetectionStrategy, Component, EventEmitter, inject, OnInit, Output, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { HttpClient } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';
import { SelectModule } from 'primeng/select';
import { TextareaModule } from 'primeng/textarea';
import { RippleModule } from 'primeng/ripple';
import { TabsModule } from 'primeng/tabs';
import { I18nService } from '../../../core/i18n.service';
import { ToastService } from '../../../shared/toast.service';
import { AppIcon } from '../../../shared/app-icon';
import { AiRiskLibrary, LibraryRow } from './ai-risk-library';

@Component({
  selector: 'app-ai-risk-initiation',
  standalone: true,
  imports: [FormsModule, SelectModule, TextareaModule, RippleModule, TabsModule, AppIcon, AiRiskLibrary],
  template: `
    <section class="risk-create-card">
      <header class="risk-create-head risk-create-banner">
        <span class="risk-create-icon"><app-icon name="shield" /></span>
        <div><span class="eyebrow">{{ t('aiRisk.stage.1') }}</span><h2>{{ t('aiInitiation.title') }}</h2><p>{{ t('aiInitiation.help') }}</p></div>
      </header>
      <p-tabs class="risk-create-tabs" [value]="activeView()" (valueChange)="activeView.set($any($event))" [lazy]="true">
        <p-tablist>
          <p-tab value="create"><span class="risk-create-tab"><app-icon name="edit" /><span><strong>{{ t('aiInitiation.title') }}</strong><small>{{ t('aiInitiation.useCase') }}</small></span></span></p-tab>
          <p-tab value="library"><span class="risk-create-tab"><app-icon name="listCheck" /><span><strong>{{ t('aiLibrary.title') }}</strong><small>{{ t('aiInitiation.librarySource') }}</small></span></span></p-tab>
        </p-tablist>
        <p-tabpanels>
          <p-tabpanel value="create">
            <ol class="risk-manual-path" [attr.aria-label]="t('aiRisk.manualPath.title')">
              <li><span>1</span><div><strong>{{ t('aiRisk.manualPath.create') }}</strong><small>{{ t('aiInitiation.useCase') }}</small></div></li>
              <li><span>2</span><div><strong>{{ t('aiRisk.manualPath.assign') }}</strong><small>{{ t('aiRisk.owner') }}</small></div></li>
              <li><span>3</span><div><strong>{{ t('aiRisk.manualPath.complete') }}</strong><small>{{ t('aiRisk.intake') }}</small></div></li>
            </ol>
            @if (state() === 'loading') {
              <div class="risk-create-state" role="status">{{ t('crud.loading') }}</div>
            } @else if (state() === 'error') {
              <div class="risk-create-state"><p>{{ t('aiInitiation.error') }}</p><button type="button" class="ds-btn ds-btn--ghost" pRipple (click)="load()">{{ t('crud.retry') }}</button></div>
            } @else if (context().canCreate) {
              <fieldset class="risk-create-form" [disabled]="working()">
                <div class="risk-create-grid">
                  <label class="risk-form-field">
                    <span>{{ t('aiInitiation.useCase') }}</span>
                    <p-select [options]="parentOptions()" optionLabel="label" optionValue="value" [filter]="true" [showClear]="true" appendTo="body" [placeholder]="t('aiuc.select')" [ngModel]="useCaseId() || null" [ngModelOptions]="{standalone:true}" (ngModelChange)="useCaseId.set($event || '')" [ariaLabel]="t('aiInitiation.useCase')" />
                    <small>{{ context().parents.length }} {{ t('aiInitiation.useCase') }}</small>
                  </label>
                  <section class="library-choice" [class.library-choice--selected]="library()">
                    <span class="risk-create-icon risk-create-icon--small"><app-icon name="listCheck" /></span>
                    @if (library(); as selectedLibrary) {
                      <div><small>{{ t('aiInitiation.librarySource') }}</small><strong>{{ selectedLibrary.libraryRef }} · {{ title(selectedLibrary) }}</strong><span>{{ t('aiDashboard.round') }} {{ selectedLibrary.round }}</span></div>
                      <button type="button" class="ds-btn ds-btn--ghost btn-sm" pRipple (click)="library.set(null)">{{ t('aiInitiation.manual') }}</button>
                    } @else {
                      <div><small>{{ t('aiInitiation.librarySource') }}</small><strong>{{ t('aiRisk.libraryOptional') }}</strong><span>{{ t('aiInitiation.provenance') }}</span></div>
                      <button type="button" class="ds-btn ds-btn--ghost btn-sm" pRipple (click)="activeView.set('library')">{{ t('aiLibrary.title') }}</button>
                    }
                  </section>
                </div>
                <label class="risk-form-field risk-form-field--wide">
                  <span>{{ t('aiReview.justification') }}</span>
                  <textarea pTextarea rows="3" maxlength="5000" [ngModel]="justification()" [ngModelOptions]="{standalone:true}" (ngModelChange)="justification.set($event)" [placeholder]="t('aiRisk.createReasonHint')"></textarea>
                </label>
                <footer class="risk-create-footer">
                  <span><app-icon name="info" />{{ t('aiInitiation.help') }}</span>
                  <button type="button" class="ds-btn ds-btn--primary risk-create-submit" pRipple [disabled]="!useCaseId() || !justification().trim() || working()" (click)="create()">{{ t('aiInitiation.create') }}</button>
                </footer>
              </fieldset>
            } @else {
              <div class="review-gate-note"><app-icon name="info" /><span>{{ t('aiInitiation.readOnly') }}</span></div>
            }
          </p-tabpanel>
          <p-tabpanel value="library">
            <div class="risk-library-picker"><app-ai-risk-library [allowChoose]="context().canCreate" [pickerMode]="true" (chosen)="choose($event)" /></div>
          </p-tabpanel>
        </p-tabpanels>
      </p-tabs>
    </section>
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
  protected readonly activeView = signal<'create' | 'library'>('create');
  protected readonly library = signal<LibraryRow | null>(null);
  protected readonly useCaseId = signal('');
  protected readonly justification = signal('');
  private requestKey = '';
  private requestSignature = '';

  protected t(key: string): string { return this.i18n.t(key); }
  protected title(row: LibraryRow): string { return row.content[this.i18n.lang() === 'ar' ? 'titleAr' : 'titleEn'] || row.libraryRef; }
  protected parentOptions() { return this.context().parents.map(parent => ({ value: parent.id, label: `${parent.useCaseRef} · ${parent.name}` })); }
  ngOnInit(): void { void this.load(); }
  protected choose(row: LibraryRow): void { if (this.context().canCreate) { this.library.set(row); this.activeView.set('create'); } }
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
