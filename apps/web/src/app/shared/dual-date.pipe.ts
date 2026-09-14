import { Pipe, PipeTransform } from '@angular/core';
import { formatDualDate } from './dual-date.format';

@Pipe({ name: 'dgopDualDate', standalone: true, pure: true })
export class DualDatePipe implements PipeTransform {
  transform(value: string | number | Date | null | undefined, format = 'medium', lang = 'en'): string {
    return formatDualDate(value, format, lang);
  }
}
