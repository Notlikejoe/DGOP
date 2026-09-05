import Aura from '@primeuix/themes/aura';
import type { PrimeNGConfigType } from 'primeng/config';

/**
 * Shared PrimeNG defaults for DGOP.
 *
 * Keep the license outside source control and merge it into this object from
 * the ignored primeui-license.local.ts file in app.config.ts. PrimeNG v22
 * displays a warning unless a valid Community or Commercial key is provided.
 */
export const dgopPrimeNgConfig: PrimeNGConfigType = {
  ripple: true,
  inputVariant: 'outlined',
  overlayAppendTo: 'body',
  zIndex: {
    modal: 1200,
    overlay: 1100,
    menu: 1100,
    tooltip: 1300,
  },
  theme: {
    preset: Aura,
    options: {
      darkModeSelector: "[data-theme='dark']",
      cssLayer: {
        name: 'primeng',
        order: 'primeng',
      },
    },
  },
};
