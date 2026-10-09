import { canAccessPage, canSeeTool, AccessReader } from './page-access';
import { NAV_SECTIONS } from '../layout/navigation';
import { routes } from '../app.routes';

describe('Shared tool and page access', () => {
  const owner:AccessReader={hasPermission:p=>['data_assets.view','assignments.view'].includes(p),hasAiScreen:()=>false};
  it('keeps AI-free roles out of every AI tool and hub', () => {
    const ai=NAV_SECTIONS.find(s=>s.id==='aiGovernance')!;
    expect(ai.items.filter(item=>canSeeTool(owner,item))).toEqual([]);
    expect(canAccessPage(owner,'/ai-governance')).toBe(false);
    expect(canAccessPage(owner,'/assets')).toBe(true);
    expect(canAccessPage(owner,'/admin/users')).toBe(false);
  });
  it('uses server AI capabilities even when generic permission codes are present', () => {
    const role:AccessReader={hasPermission:()=>true,hasAiScreen:s=>s==='useCases'};
    expect(canAccessPage(role,'/governance/ai-use-cases')).toBe(true);
    expect(canAccessPage(role,'/governance/ai-review')).toBe(false);
    expect(canAccessPage(role,'/governance/ai-reviews')).toBe(false);
  });
  it('preserves all registered privileged pages, including detail routes and aliases', () => {
    const all:AccessReader={hasPermission:()=>true,hasAiScreen:()=>true};
    const pages=routes.find(r=>r.children)!.children!.filter(r=>r.path&&!r.redirectTo&&r.path!=='**');
    const denied=pages.map(r=>'/'+r.path!.replace(/:[^/]+/g,'record-id')).filter(path=>!canAccessPage(all,path));
    expect(denied).toEqual([]);
  });
  it('guards workflow detail and designer independently from inbox access', () => {
    const inbox:AccessReader={hasPermission:p=>p==='workflow_tasks.view',hasAiScreen:()=>false};
    expect(canAccessPage(inbox,'/governance/workflow')).toBe(true);
    expect(canAccessPage(inbox,'/governance/workflow/cases/id')).toBe(false);
    expect(canAccessPage(inbox,'/governance/workflow/designer')).toBe(false);
  });
});
