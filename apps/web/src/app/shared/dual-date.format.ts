/** Presentation only: persisted instants and Saudi business-calendar calculations stay unchanged. */
export function formatDualDate(value: string | number | Date | null | undefined, format = 'medium', lang = 'en'): string {
  if (value === null || value === undefined || value === '') return '—';
  const date = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(date.getTime())) return '—';
  const locale = lang === 'ar' ? 'ar-SA' : 'en-GB';
  const options: Intl.DateTimeFormatOptions = { timeZone: 'Asia/Riyadh', day: 'numeric', month: 'short', year: 'numeric' };
  const hijri = new Intl.DateTimeFormat(locale, { ...options, calendar: 'islamic-umalqura' }).formatToParts(date).filter(part => part.type !== 'era').map(part => part.value).join('').trim();
  const gregorian = new Intl.DateTimeFormat(locale, { ...options, calendar: 'gregory' }).format(date);
  const time = format.endsWith('Date') ? '' : ' · ' + new Intl.DateTimeFormat(locale, { timeZone: 'Asia/Riyadh', hour: '2-digit', minute: '2-digit' }).format(date);
  return `${hijri} ${lang === 'ar' ? 'هـ' : 'AH'} / ${gregorian} ${lang === 'ar' ? 'م' : 'AD'}${time}`;
}
