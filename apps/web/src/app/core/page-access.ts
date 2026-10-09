import { HUB_CONFIGS, NAV_SECTIONS, NavItem } from '../layout/navigation';
import { AiCapabilities } from './auth.models';

export interface AccessReader {
  hasPermission(permission: string): boolean;
  hasAiScreen(screen: keyof AiCapabilities['screens']): boolean;
}
export const AI_PAGES: Record<string, keyof AiCapabilities['screens']> = {
  '/governance/ai-use-cases': 'useCases', '/governance/ai-risks': 'risks',
  '/governance/ai-review': 'review', '/governance/ai-reviews': 'reviewOperations',
  '/governance/ai-dashboard': 'dashboard', '/governance/ai-migration': 'migration',
};
export function canSeeTool(auth: AccessReader, item: NavItem): boolean {
  const screen = AI_PAGES[item.link];
  if (screen) return auth.hasAiScreen(screen);
  return !item.permission || (typeof item.permission === 'string' ? auth.hasPermission(item.permission)
    : item.permission.some(permission => auth.hasPermission(permission)));
}
export function canAccessPage(auth: AccessReader, url: string): boolean {
  const path = url.split(/[?#]/)[0].replace(/\/$/, '') || '/';
  if (path === '/' || path === '/about') return true;
  if (path === '/governance/workflow/designer') return auth.hasPermission('workflow_cases.edit');
  if (path.startsWith('/governance/workflow/cases/')) return auth.hasPermission('workflow_cases.view');
  const hub = HUB_CONFIGS.find(h => NAV_SECTIONS.some(s => h.sectionIds.includes(s.id) && s.homeLink === path));
  if (hub) return NAV_SECTIONS.filter(s => hub.sectionIds.includes(s.id)).some(s => s.items.some(item => canSeeTool(auth, item)));
  const item = NAV_SECTIONS.flatMap(s => s.items).sort((a,b) => b.link.length-a.link.length)
    .find(item => path === item.link || path.startsWith(item.link + '/'));
  return !!item && canSeeTool(auth, item);
}
