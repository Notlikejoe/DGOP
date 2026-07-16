import { ChangeDetectionStrategy, Component, Input } from '@angular/core';

const ICON_PATHS = {
  dashboard: [
    'M4 4h7v7H4z',
    'M13 4h7v4h-7z',
    'M13 10h7v10h-7z',
    'M4 13h7v7H4z',
  ],
  info: ['M12 17v-6', 'M12 7h.01', 'M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0'],
  palette: [
    'M12 22a10 10 0 1 1 10-10c0 2.5-1.5 3.5-3.2 3.5H17a2 2 0 0 0 0 4h.5C16 21 14.2 22 12 22',
    'M7.5 10.5h.01',
    'M10.5 7.5h.01',
    'M14.5 7.5h.01',
    'M16.5 11.5h.01',
  ],
  map: [
    'M14.1 5.6a2 2 0 0 0 1.8 0l3.7-1.9A1 1 0 0 1 21 4.6v12.8a1 1 0 0 1-.6.9l-4.5 2.3a2 2 0 0 1-1.8 0l-4.2-2.1a2 2 0 0 0-1.8 0l-3.7 1.8A1 1 0 0 1 3 19.4V6.6a1 1 0 0 1 .6-.9l4.5-2.3a2 2 0 0 1 1.8 0z',
    'M9 3.2v15.2',
    'M15 5.8v15',
  ],
  shield: ['M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10'],
  database: [
    'M4 6c0 2 3.6 3 8 3s8-1 8-3-3.6-3-8-3-8 1-8 3',
    'M4 6v6c0 2 3.6 3 8 3s8-1 8-3V6',
    'M4 12v6c0 2 3.6 3 8 3s8-1 8-3v-6',
  ],
  userCheck: ['M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2', 'M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8', 'M16 11l2 2 4-4'],
  listCheck: ['M8 6h13', 'M8 12h13', 'M8 18h13', 'M3 6l1 1 2-2', 'M3 12l1 1 2-2', 'M3 18l1 1 2-2'],
  plus: ['M12 5v14', 'M5 12h14'],
  menu: ['M4 6h16', 'M4 12h16', 'M4 18h16'],
  x: ['M18 6 6 18', 'M6 6l12 12'],
  refresh: ['M21 12a9 9 0 0 1-15.5 6.2L3 16', 'M3 21v-5h5', 'M3 12A9 9 0 0 1 18.5 5.8L21 8', 'M21 3v5h-5'],
  edit: ['M12 20h9', 'M16.5 3.5a2.1 2.1 0 0 1 3 3L8 18l-4 1 1-4z'],
  trash: ['M3 6h18', 'M8 6V4h8v2', 'M6 6l1 14h10l1-14', 'M10 11v5', 'M14 11v5'],
  lock: ['M7 11V7a5 5 0 0 1 10 0v4', 'M5 11h14v10H5z'],
  unlock: ['M7 11V7a5 5 0 0 1 9.5-2.2', 'M5 11h14v10H5z'],
  filter: ['M4 5h16', 'M7 12h10', 'M10 19h4'],
  alert: ['M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0', 'M12 9v4', 'M12 17h.01'],
  workflow: ['M6 3v6', 'M18 15v6', 'M6 9a3 3 0 1 0 0 6h6a3 3 0 0 1 3 3v3', 'M18 15a3 3 0 1 0 0-6h-6a3 3 0 0 1-3-3V3'],
  fileCheck: ['M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z', 'M14 2v6h6', 'M9 15l2 2 4-4'],
  graduationCap: ['M22 10 12 5 2 10l10 5 10-5', 'M6 12v5c2 2 4 3 6 3s4-1 6-3v-5', 'M22 10v6'],
  activity: ['M22 12h-4l-3 8-6-16-3 8H2'],
  gauge: ['M21 13a9 9 0 1 0-18 0', 'M12 13l4-4', 'M7 13h.01', 'M17 13h.01'],
  search: ['M11 18a7 7 0 1 1 0-14 7 7 0 0 1 0 14', 'M21 21l-4.3-4.3'],
  searchAlert: ['M11 18a7 7 0 1 1 0-14 7 7 0 0 1 0 14', 'M21 21l-4.3-4.3', 'M11 7v4', 'M11 14h.01'],
  keyRound: ['M2 18a5 5 0 1 1 8.6-3.5L22 3v4h-4v4h-4v4h-3.4A5 5 0 0 1 2 18', 'M7 18h.01'],
  users: ['M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2', 'M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8', 'M22 21v-2a4 4 0 0 0-3-3.9', 'M16 3.1a4 4 0 0 1 0 7.8'],
  scrollText: ['M8 21h12a2 2 0 0 0 2-2V5a3 3 0 0 0-3-3H8', 'M8 21a3 3 0 0 1-3-3V4a2 2 0 1 0-4 0v3h4', 'M10 8h8', 'M10 12h8', 'M10 16h5'],
  settings: ['M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6', 'M19.4 15a1.7 1.7 0 0 0 .3 1.9l.1.1a2 2 0 0 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.9-.3 1.7 1.7 0 0 0-1 1.6V21a2 2 0 0 1-4 0v-.1a1.7 1.7 0 0 0-1-1.6 1.7 1.7 0 0 0-1.9.3l-.1.1A2 2 0 0 1 4.2 17l.1-.1a1.7 1.7 0 0 0 .3-1.9 1.7 1.7 0 0 0-1.6-1H3a2 2 0 0 1 0-4h.1a1.7 1.7 0 0 0 1.6-1 1.7 1.7 0 0 0-.3-1.9L4.3 7A2 2 0 0 1 7 4.2l.1.1a1.7 1.7 0 0 0 1.9.3h.1a1.7 1.7 0 0 0 1-1.6V3a2 2 0 0 1 4 0v.1a1.7 1.7 0 0 0 1 1.6h.1a1.7 1.7 0 0 0 1.9-.3l.1-.1A2 2 0 0 1 19.8 7l-.1.1a1.7 1.7 0 0 0-.3 1.9v.1a1.7 1.7 0 0 0 1.6 1h.1a2 2 0 0 1 0 4H21a1.7 1.7 0 0 0-1.6 1'],
  contact: ['M16 2v4', 'M8 2v4', 'M3 10h18', 'M5 4h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2', 'M12 14a2 2 0 1 0 0-4 2 2 0 0 0 0 4', 'M8 18a4 4 0 0 1 8 0'],
  network: ['M12 5a3 3 0 1 0 0 6 3 3 0 0 0 0-6', 'M5 18a3 3 0 1 0 0-6 3 3 0 0 0 0 6', 'M19 18a3 3 0 1 0 0-6 3 3 0 0 0 0 6', 'M10 10l-3 3', 'M14 10l3 3'],
  fingerprint: ['M2 12a10 10 0 0 1 18-6', 'M4 16a8 8 0 0 1 14-8', 'M6 20a6 6 0 0 0 12-5v-2a4 4 0 0 0-8 0v2a2 2 0 0 0 4 0v-2'],
  briefcase: ['M10 6V5a2 2 0 0 1 2-2h0a2 2 0 0 1 2 2v1', 'M3 7h18v12a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z', 'M3 13h18', 'M12 13v2'],
  building: ['M3 21h18', 'M6 21V5a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v16', 'M9 7h1', 'M14 7h1', 'M9 11h1', 'M14 11h1', 'M9 15h1', 'M14 15h1'],
  server: ['M4 4h16v6H4z', 'M4 14h16v6H4z', 'M7 7h.01', 'M7 17h.01'],
  tags: ['M20.6 13.4 13.4 20.6a2 2 0 0 1-2.8 0L3 13V3h10l7.6 7.6a2 2 0 0 1 0 2.8', 'M7.5 7.5h.01', 'M16 5l5 5'],
  idCard: ['M4 4h16v16H4z', 'M8 9h.01', 'M11 9h5', 'M8 13h8', 'M8 17h5'],
  clipboardList: ['M9 4h6', 'M9 2h6v4H9z', 'M5 4h2', 'M17 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2', 'M8 12h8', 'M8 16h8'],
  plug: ['M9 2v6', 'M15 2v6', 'M7 8h10v5a5 5 0 0 1-10 0z', 'M12 18v4', 'M8 22h8'],
  globe: ['M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18', 'M3.6 9h16.8', 'M3.6 15h16.8', 'M12 3a14 14 0 0 1 0 18', 'M12 3a14 14 0 0 0 0 18'],
} as const;

export type AppIconName = keyof typeof ICON_PATHS;

@Component({
  selector: 'app-icon',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <svg
      aria-hidden="true"
      class="app-icon"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-width="2"
      stroke-linecap="round"
      stroke-linejoin="round"
    >
      @for (path of paths; track path) {
        <path [attr.d]="path" />
      }
    </svg>
  `,
  styles: [
    `
      :host {
        display: inline-grid;
        place-items: center;
        width: 1em;
        height: 1em;
      }

      .app-icon {
        width: 1em;
        height: 1em;
      }
    `,
  ],
})
export class AppIcon {
  @Input() name: AppIconName = 'dashboard';

  protected get paths(): readonly string[] {
    return ICON_PATHS[this.name];
  }
}
