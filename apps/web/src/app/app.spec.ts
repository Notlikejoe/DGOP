import { TestBed } from '@angular/core/testing';
import { I18nService } from './core/i18n.service';

describe('I18nService', () => {
  it('returns English and Arabic translations', () => {
    TestBed.configureTestingModule({});
    const i18n = TestBed.inject(I18nService);

    i18n.setLang('en');
    expect(i18n.t('nav.dashboard')).toBe('Command Center');
    expect(i18n.dir()).toBe('ltr');

    i18n.setLang('ar');
    expect(i18n.t('nav.dashboard')).toBe('مركز القيادة');
    expect(i18n.dir()).toBe('rtl');
  });
});
