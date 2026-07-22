import { ChangeDetectionStrategy, Component, HostListener, inject } from '@angular/core';
import { I18nService } from '../core/i18n.service';
import { ToastService } from './toast.service';

@Component({
  selector: 'app-problem-screen',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (toast.activeProblem(); as problem) {
      <section class="problem-backdrop" role="presentation" [attr.dir]="i18n.dir()">
        <article
          class="problem"
          role="dialog"
          aria-modal="true"
          [attr.aria-labelledby]="'problem-title'"
          [attr.aria-describedby]="'problem-summary'"
        >
          <header class="problem__header">
            <div class="problem__mark" aria-hidden="true">
              <span></span>
            </div>
            <div>
              <p class="problem__eyebrow">{{ t('problem.eyebrow') }}</p>
              <h2 id="problem-title">{{ problem.title }}</h2>
              <p id="problem-summary">{{ problem.message }}</p>
            </div>
            <button type="button" class="problem__close" (click)="close()" [attr.aria-label]="t('crud.close')">
              x
            </button>
          </header>

          <div class="problem__body">
            <section class="problem__section problem__section--primary">
              <h3>{{ t('problem.whatHappened') }}</h3>
              <p>{{ explanationFor(problem.category) }}</p>
            </section>

            <section class="problem__section">
              <div class="problem__section-head">
                <h3>{{ t('problem.ruleChecks') }}</h3>
                <span class="problem__count">
                  {{ problem.violations.length || 1 }} {{ t('problem.items') }}
                </span>
              </div>
              @if (problem.violations.length) {
                <ul class="problem__rules">
                  @for (violation of problem.violations; track violation) {
                    <li>{{ violation }}</li>
                  }
                </ul>
              } @else {
                <p class="problem__muted">{{ problem.detail || t('problem.noSpecificRule') }}</p>
              }
            </section>

            <section class="problem__section">
              <h3>{{ t('problem.nextSteps') }}</h3>
              <ol class="problem__steps">
                @for (step of problem.nextSteps; track step) {
                  <li>{{ step }}</li>
                }
              </ol>
            </section>

            <aside class="problem__trace" [attr.aria-label]="t('problem.trace')">
              <div>
                <span>{{ t('problem.code') }}</span>
                <strong>{{ problem.code }}</strong>
              </div>
              @if (problem.requestId) {
                <div>
                  <span>{{ t('problem.requestId') }}</span>
                  <strong>{{ problem.requestId }}</strong>
                </div>
              }
              @if (problem.path) {
                <div>
                  <span>{{ t('problem.where') }}</span>
                  <strong>{{ problem.method }} {{ problem.path }}</strong>
                </div>
              }
            </aside>
          </div>

          <footer class="problem__footer">
            @if (problem.requestId) {
              <button type="button" class="ds-btn ds-btn--ghost" (click)="copyRequestId(problem.requestId)">
                {{ t('problem.copyRequestId') }}
              </button>
            }
            <button type="button" class="ds-btn ds-btn--primary" (click)="close()">
              {{ t('problem.backToForm') }}
            </button>
          </footer>
        </article>
      </section>
    }
  `,
  styles: [
    `
      .problem-backdrop {
        position: fixed;
        inset: 0;
        z-index: 1200;
        display: grid;
        place-items: center;
        padding: var(--space-5);
        background: color-mix(in srgb, #031010 72%, transparent);
      }

      .problem {
        width: min(840px, 100%);
        max-height: min(820px, calc(100vh - var(--space-8)));
        overflow: auto;
        color: var(--command-on);
        background: var(--command-surface);
        border: 1px solid var(--command-border);
        border-radius: var(--radius-lg);
        box-shadow: var(--shadow-lg);
      }

      .problem__header {
        display: grid;
        grid-template-columns: 52px minmax(0, 1fr) auto;
        gap: var(--space-4);
        align-items: start;
        padding: var(--space-5);
        border-bottom: 1px solid var(--command-border);
      }

      .problem__mark {
        display: grid;
        place-items: center;
        width: 52px;
        height: 52px;
        background: color-mix(in srgb, var(--warning) 18%, var(--command-surface-2));
        border: 1px solid color-mix(in srgb, var(--warning) 48%, var(--command-border));
        border-radius: var(--radius-md);
      }

      .problem__mark span {
        width: 22px;
        height: 22px;
        border-radius: 50%;
        background:
          linear-gradient(var(--warning), var(--warning)) center 5px / 3px 9px no-repeat,
          linear-gradient(var(--warning), var(--warning)) center 17px / 3px 3px no-repeat,
          color-mix(in srgb, var(--warning) 16%, transparent);
        border: 2px solid var(--warning);
      }

      .problem__eyebrow {
        margin: 0 0 var(--space-1);
        color: var(--command-muted);
        font-size: var(--font-size-xs);
        font-weight: 800;
        letter-spacing: 0.08em;
        text-transform: uppercase;
      }

      .problem h2 {
        margin: 0;
        font-size: var(--font-size-2xl);
        line-height: 1.15;
      }

      .problem__header p:last-child {
        margin: var(--space-2) 0 0;
        color: var(--command-muted);
      }

      .problem__close {
        display: grid;
        place-items: center;
        width: 36px;
        height: 36px;
        color: var(--command-muted);
        background: var(--command-surface-2);
        border: 1px solid var(--command-border);
        border-radius: var(--radius-md);
        cursor: pointer;
        font: inherit;
        font-weight: 800;
      }

      .problem__close:focus-visible,
      .problem__footer button:focus-visible {
        outline: 2px solid var(--focus-ring);
        outline-offset: 2px;
      }

      .problem__body {
        display: grid;
        gap: var(--space-4);
        padding: var(--space-5);
      }

      .problem__section,
      .problem__trace {
        padding: var(--space-4);
        background: var(--command-surface-2);
        border: 1px solid var(--command-border);
        border-radius: var(--radius-md);
      }

      .problem__section--primary {
        border-inline-start: 4px solid var(--warning);
      }

      .problem__section h3 {
        margin: 0 0 var(--space-2);
        font-size: var(--font-size-lg);
      }

      .problem__section p {
        margin: 0;
        color: var(--command-muted);
      }

      .problem__section-head {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: var(--space-3);
        margin-bottom: var(--space-2);
      }

      .problem__count {
        flex: 0 0 auto;
        padding: 2px var(--space-2);
        color: var(--warning);
        background: color-mix(in srgb, var(--warning) 14%, transparent);
        border-radius: var(--radius-pill);
        font-size: var(--font-size-xs);
        font-weight: 800;
      }

      .problem__rules,
      .problem__steps {
        margin: 0;
        padding-inline-start: var(--space-5);
      }

      .problem__rules li,
      .problem__steps li {
        margin-block: var(--space-2);
      }

      .problem__muted {
        color: var(--command-muted);
      }

      .problem__trace {
        display: grid;
        grid-template-columns: repeat(3, minmax(0, 1fr));
        gap: var(--space-3);
      }

      .problem__trace div {
        min-width: 0;
      }

      .problem__trace span {
        display: block;
        color: var(--command-muted);
        font-size: var(--font-size-xs);
        font-weight: 800;
        text-transform: uppercase;
      }

      .problem__trace strong {
        display: block;
        margin-top: 2px;
        overflow-wrap: anywhere;
      }

      .problem__footer {
        display: flex;
        justify-content: flex-end;
        gap: var(--space-3);
        padding: var(--space-4) var(--space-5) var(--space-5);
        border-top: 1px solid var(--command-border);
      }

      @media (max-width: 760px) {
        .problem-backdrop {
          align-items: stretch;
          padding: var(--space-3);
        }

        .problem {
          max-height: calc(100vh - var(--space-6));
        }

        .problem__header {
          grid-template-columns: 44px minmax(0, 1fr) auto;
          padding: var(--space-4);
        }

        .problem__mark {
          width: 44px;
          height: 44px;
        }

        .problem__body,
        .problem__footer {
          padding: var(--space-4);
        }

        .problem__trace {
          grid-template-columns: 1fr;
        }

        .problem__footer {
          flex-direction: column-reverse;
        }
      }
    `,
  ],
})
export class ProblemScreen {
  protected readonly toast = inject(ToastService);
  protected readonly i18n = inject(I18nService);

  @HostListener('document:keydown.escape')
  close(): void {
    this.toast.dismissProblem();
  }

  protected t(key: string): string {
    return this.i18n.t(key);
  }

  protected explanationFor(category: string): string {
    if (category === 'conflict') return this.t('problem.explain.conflict');
    if (category === 'import') return this.t('problem.explain.import');
    return this.t('problem.explain.validation');
  }

  protected copyRequestId(requestId: string): void {
    if (typeof navigator !== 'undefined' && navigator.clipboard) {
      void navigator.clipboard.writeText(requestId);
    }
  }
}
