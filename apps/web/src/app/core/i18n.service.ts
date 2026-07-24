import { Injectable, computed, signal } from '@angular/core';
import type { Dict } from './i18n.dictionary';

export type Lang = 'en' | 'ar';

const STORAGE_KEY = 'dgop.lang';

const FALLBACK_DICT: Dict = {
  'app.shortTitle': { en: 'DGOP', ar: 'منصة DGOP' },
  'app.title': { en: 'Data Governance Operations Platform', ar: 'منصة عمليات حوكمة البيانات' },
  'nav.dashboard': { en: 'Command Center', ar: 'مركز القيادة' },
  'crud.loading': { en: 'Loading...', ar: 'جار التحميل...' },
};

@Injectable({ providedIn: 'root' })
export class I18nService {
  readonly lang = signal<Lang>('en');
  readonly dir = computed<'ltr' | 'rtl'>(() => (this.lang() === 'ar' ? 'rtl' : 'ltr'));

  private dictionary: Dict = FALLBACK_DICT;
  private loadPromise: Promise<void> | null = null;

  async ready(): Promise<void> {
    this.init();
    await this.loadDictionary();
  }

  init(): void {
    const saved = (localStorage.getItem(STORAGE_KEY) as Lang | null) ?? 'en';
    this.setLang(saved);
  }

  setLang(lang: Lang): void {
    this.lang.set(lang);
    const dir = lang === 'ar' ? 'rtl' : 'ltr';
    document.documentElement.setAttribute('lang', lang);
    document.documentElement.setAttribute('dir', dir);
    localStorage.setItem(STORAGE_KEY, lang);
  }

  toggle(): void {
    this.setLang(this.lang() === 'en' ? 'ar' : 'en');
  }

  t(key: string): string {
    const entry = this.dictionary[key];
    if (!entry) return key;
    return entry[this.lang()];
  }

  private loadDictionary(): Promise<void> {
    if (!this.loadPromise) {
      this.loadPromise = import('./i18n.dictionary')
        .then(({ DICT }) => {
          this.dictionary = { ...FALLBACK_DICT, ...DICT };
        })
        .catch(() => {
          this.dictionary = FALLBACK_DICT;
        });
    }
    return this.loadPromise;
  }
}
