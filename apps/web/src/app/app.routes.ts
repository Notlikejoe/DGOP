import { Routes } from '@angular/router';
import { authGuard, permissionGuard } from './core/auth.guards';

export const routes: Routes = [
  {
    path: 'login',
    loadComponent: () => import('./pages/login/login').then((m) => m.Login),
  },
  {
    path: 'unauthorized',
    loadComponent: () =>
      import('./pages/unauthorized/unauthorized').then((m) => m.Unauthorized),
  },
  {
    path: '',
    canActivate: [authGuard],
    loadComponent: () => import('./layout/shell').then((m) => m.Shell),
    children: [
      { path: '', pathMatch: 'full', redirectTo: 'dashboard' },
      {
        path: 'dashboard',
        loadComponent: () => import('./pages/dashboard/dashboard').then((m) => m.Dashboard),
      },
      {
        path: 'about',
        loadComponent: () => import('./pages/about/about').then((m) => m.AboutPage),
      },
      {
        path: 'design-system',
        loadComponent: () =>
          import('./pages/design-system/design-system').then((m) => m.DesignSystem),
      },
      {
        path: 'governance',
        loadComponent: () =>
          import('./pages/section-hub/section-hub').then((m) => m.SectionHubPage),
        data: { hubId: 'governance' },
      },
      {
        path: 'assets',
        canActivate: [permissionGuard('data_assets.view')],
        loadComponent: () => import('./pages/admin/assets/assets').then((m) => m.AssetsPage),
      },
      {
        path: 'governance/ownership',
        canActivate: [permissionGuard('assignments.view')],
        loadComponent: () =>
          import('./pages/governance/ownership/ownership').then((m) => m.OwnershipPage),
      },
      {
        path: 'governance/assignment-rules',
        canActivate: [permissionGuard('assignment_rules.view')],
        loadComponent: () =>
          import('./pages/governance/assignment-rules/assignment-rules').then(
            (m) => m.AssignmentRulesPage,
          ),
      },
      {
        path: 'governance/exception-queue',
        canActivate: [permissionGuard('assignments.view')],
        loadComponent: () =>
          import('./pages/governance/exception-queue/exception-queue').then(
            (m) => m.ExceptionQueuePage,
          ),
      },
      {
        path: 'governance/workflow',
        canActivate: [permissionGuard('workflow_tasks.view')],
        loadComponent: () =>
          import('./pages/governance/workflow/workflow').then((m) => m.WorkflowPage),
      },
      {
        path: 'governance/workflow/cases/:id',
        canActivate: [permissionGuard('workflow_cases.view')],
        loadComponent: () =>
          import('./pages/governance/workflow/case-detail').then((m) => m.WorkflowCasePage),
      },
      {
        path: 'governance/ndi',
        canActivate: [permissionGuard('ndi_specifications.view')],
        loadComponent: () => import('./pages/governance/ndi/ndi-hub').then((m) => m.NdiHubPage),
      },
      {
        path: 'governance/ndi/readiness',
        canActivate: [permissionGuard('ndi_scoring.view')],
        loadComponent: () =>
          import('./pages/governance/ndi/ndi-readiness').then((m) => m.NdiReadinessPage),
      },
      {
        path: 'governance/ndi/gaps',
        canActivate: [permissionGuard('ndi_scoring.view')],
        loadComponent: () =>
          import('./pages/governance/ndi/ndi-gaps').then((m) => m.NdiGapsPage),
      },
      {
        path: 'governance/ndi/audit-packs',
        canActivate: [permissionGuard('ndi_audit_packs.view')],
        loadComponent: () =>
          import('./pages/governance/audit-packs/audit-packs').then((m) => m.AuditPacksPage),
      },
      {
        path: 'governance/extended-domains',
        canActivate: [permissionGuard('extended_domains.view')],
        loadComponent: () =>
          import('./pages/governance/extended-domains/extended-domains').then(
            (m) => m.ExtendedDomainsPage,
          ),
      },
      {
        path: 'governance/business-value',
        canActivate: [permissionGuard('business_value.view')],
        loadComponent: () =>
          import('./pages/governance/business-value/business-value').then(
            (m) => m.BusinessValuePage,
          ),
      },
      {
        path: 'governance/operations',
        canActivate: [permissionGuard('governance_operations.view')],
        loadComponent: () =>
          import('./pages/governance/governance-operations/governance-operations').then(
            (m) => m.GovernanceOperationsPage,
          ),
      },
      {
        path: 'governance/ndi/specifications',
        canActivate: [permissionGuard('ndi_specifications.view')],
        loadComponent: () =>
          import('./pages/governance/ndi/ndi-registry').then((m) => m.NdiRegistryPage),
      },
      {
        path: 'governance/ndi/specifications/:id',
        canActivate: [permissionGuard('ndi_specifications.view')],
        loadComponent: () =>
          import('./pages/governance/ndi/ndi-registry').then((m) => m.NdiRegistryPage),
      },
      {
        path: 'governance/training',
        canActivate: [permissionGuard('training_assignments.view')],
        loadComponent: () =>
          import('./pages/governance/training/training').then((m) => m.TrainingPage),
      },
      {
        path: 'governance/data-quality',
        canActivate: [permissionGuard('data_quality_issues.view')],
        loadComponent: () =>
          import('./pages/governance/data-quality/data-quality').then((m) => m.DataQualityPage),
      },
      {
        path: 'governance/security',
        canActivate: [permissionGuard('security_governance.view')],
        loadComponent: () =>
          import('./pages/governance/security-governance/security-governance').then(
            (m) => m.SecurityGovernancePage,
          ),
      },
      {
        path: 'governance/open-data',
        canActivate: [permissionGuard('open_data_candidates.view')],
        loadComponent: () =>
          import('./pages/governance/open-data/open-data').then((m) => m.OpenDataPage),
      },
      {
        path: 'governance/open-data/:id',
        canActivate: [permissionGuard('open_data_candidates.view')],
        loadComponent: () =>
          import('./pages/governance/open-data/open-data').then((m) => m.OpenDataPage),
      },
      {
        path: 'governance/foi',
        canActivate: [permissionGuard('foi_requests.view')],
        loadComponent: () => import('./pages/governance/foi/foi').then((m) => m.FoiPage),
      },
      {
        path: 'governance/foi/:id',
        canActivate: [permissionGuard('foi_requests.view')],
        loadComponent: () => import('./pages/governance/foi/foi').then((m) => m.FoiPage),
      },
      {
        path: 'governance/privacy',
        canActivate: [permissionGuard('privacy_operations.view')],
        loadComponent: () =>
          import('./pages/governance/privacy/privacy').then((m) => m.PrivacyOperationsPage),
      },
      {
        path: 'governance/data-sharing',
        canActivate: [permissionGuard('data_sharing_requests.view')],
        loadComponent: () =>
          import('./pages/governance/data-sharing/data-sharing').then((m) => m.DataSharingPage),
      },
      {
        path: 'governance/transparency',
        canActivate: [permissionGuard('dashboard.view')],
        loadComponent: () =>
          import('./pages/governance/transparency-cockpit/transparency-cockpit').then(
            (m) => m.TransparencyCockpitPage,
          ),
      },
      {
        path: 'governance/reports',
        canActivate: [permissionGuard('dashboard.view')],
        loadComponent: () =>
          import('./pages/governance/reports/reports').then((m) => m.ReportsPage),
      },
      {
        path: 'admin',
        loadComponent: () =>
          import('./pages/section-hub/section-hub').then((m) => m.SectionHubPage),
        data: { hubId: 'administration' },
      },
      {
        path: 'admin/people',
        canActivate: [permissionGuard('people.view')],
        loadComponent: () => import('./pages/admin/people/people').then((m) => m.PeoplePage),
      },
      {
        path: 'admin/roles',
        canActivate: [permissionGuard('roles.view')],
        loadComponent: () => import('./pages/admin/roles/roles').then((m) => m.RolesPage),
      },
      {
        path: 'admin/audit',
        canActivate: [permissionGuard('audit.view')],
        loadComponent: () => import('./pages/admin/audit/audit-log').then((m) => m.AuditLogPage),
      },
      {
        path: 'admin/integrations',
        canActivate: [permissionGuard('integrations.view')],
        loadComponent: () =>
          import('./pages/admin/integrations/integrations').then((m) => m.IntegrationsPage),
      },
      {
        path: 'admin/users',
        canActivate: [permissionGuard('users.view')],
        loadComponent: () => import('./pages/admin/users/users').then((m) => m.UsersPage),
      },
      {
        path: 'admin/data-domains',
        canActivate: [permissionGuard('data_domains.view')],
        loadComponent: () =>
          import('./pages/admin/data-domains/data-domains').then((m) => m.DataDomainsPage),
      },
      {
        path: 'admin/data-subjects',
        canActivate: [permissionGuard('data_subjects.view')],
        loadComponent: () =>
          import('./pages/admin/data-subjects/data-subjects').then((m) => m.DataSubjectsPage),
      },
      {
        path: 'admin/capabilities',
        canActivate: [permissionGuard('business_capabilities.view')],
        loadComponent: () =>
          import('./pages/admin/business-capabilities/business-capabilities').then(
            (m) => m.BusinessCapabilitiesPage,
          ),
      },
      {
        path: 'admin/org-units',
        canActivate: [permissionGuard('org_units.view')],
        loadComponent: () =>
          import('./pages/admin/org-units/org-units').then((m) => m.OrgUnitsPage),
      },
      {
        path: 'admin/systems',
        canActivate: [permissionGuard('systems.view')],
        loadComponent: () => import('./pages/admin/systems/systems').then((m) => m.SystemsPage),
      },
      {
        path: 'admin/classifications',
        canActivate: [permissionGuard('classifications.view')],
        loadComponent: () =>
          import('./pages/admin/classifications/classifications').then((m) => m.ClassificationsPage),
      },
      {
        path: 'admin/role-types',
        canActivate: [permissionGuard('role_types.view')],
        loadComponent: () =>
          import('./pages/admin/role-types/role-types').then((m) => m.RoleTypesPage),
      },
      {
        path: 'admin/raci-templates',
        canActivate: [permissionGuard('raci_templates.view')],
        loadComponent: () =>
          import('./pages/admin/raci-templates/raci-templates').then((m) => m.RaciTemplatesPage),
      },
      {
        path: 'admin/status-values',
        canActivate: [permissionGuard('status_values.view')],
        loadComponent: () =>
          import('./pages/admin/status-values/status-values').then((m) => m.StatusValuesPage),
      },
    ],
  },
  { path: '**', redirectTo: '' },
];
