import { AppIconName } from '../shared/app-icon';

export type NavSectionId =
  | 'overview'
  | 'foundation'
  | 'governance'
  | 'accessManagement'
  | 'administration';

export type HubId = 'governance' | 'administration';

export interface NavItem {
  labelKey: string;
  descriptionKey: string;
  icon: string;
  iconName: AppIconName;
  link: string;
  permission?: string;
  groupKey?: string;
  featured?: boolean;
  /** When true, the shell shows the user's open-task count as a badge. */
  badge?: boolean;
}

export interface NavSection {
  id: NavSectionId;
  titleKey: string;
  summaryKey?: string;
  homeLink?: string;
  icon?: string;
  iconName?: AppIconName;
  items: NavItem[];
}

export interface HubConfig {
  id: HubId;
  sectionIds: NavSectionId[];
  eyebrowKey: string;
  titleKey: string;
  subtitleKey: string;
  checklistTitleKey: string;
  checklistKeys: string[];
}

export const NAV_SECTIONS: NavSection[] = [
  {
    id: 'overview',
    titleKey: 'nav.section.overview',
    items: [
      {
        labelKey: 'nav.dashboard',
        descriptionKey: 'nav.desc.dashboard',
        icon: 'CC',
        iconName: 'dashboard',
        link: '/dashboard',
        permission: 'dashboard.view',
      },
    ],
  },
  {
    id: 'foundation',
    titleKey: 'nav.section.foundation',
    items: [
      {
        labelKey: 'nav.about',
        descriptionKey: 'nav.desc.about',
        icon: 'DG',
        iconName: 'info',
        link: '/about',
      },
      {
        labelKey: 'nav.designSystem',
        descriptionKey: 'nav.desc.designSystem',
        icon: 'DS',
        iconName: 'map',
        link: '/governance-map',
        permission: 'design_system.view',
      },
    ],
  },
  {
    id: 'governance',
    titleKey: 'nav.section.governance',
    summaryKey: 'nav.section.governance.summary',
    homeLink: '/governance',
    icon: 'GV',
    iconName: 'shield',
    items: [
      {
        labelKey: 'nav.dataAssets',
        descriptionKey: 'nav.desc.dataAssets',
        icon: 'AM',
        iconName: 'database',
        link: '/assets',
        permission: 'data_assets.view',
        groupKey: 'hub.group.assets',
        featured: true,
      },
      {
        labelKey: 'nav.ownership',
        descriptionKey: 'nav.desc.ownership',
        icon: 'OW',
        iconName: 'userCheck',
        link: '/governance/ownership',
        permission: 'assignments.view',
        groupKey: 'hub.group.assets',
        featured: true,
      },
      {
        labelKey: 'nav.assignmentRules',
        descriptionKey: 'nav.desc.assignmentRules',
        icon: 'AR',
        iconName: 'listCheck',
        link: '/governance/assignment-rules',
        permission: 'assignment_rules.view',
        groupKey: 'hub.group.assets',
      },
      {
        labelKey: 'nav.exceptions',
        descriptionKey: 'nav.desc.exceptions',
        icon: 'RQ',
        iconName: 'alert',
        link: '/governance/exception-queue',
        permission: 'assignments.view',
        groupKey: 'hub.group.review',
        featured: true,
      },
      {
        labelKey: 'nav.workflow',
        descriptionKey: 'nav.desc.workflow',
        icon: 'WF',
        iconName: 'workflow',
        link: '/governance/workflow',
        permission: 'workflow_tasks.view',
        groupKey: 'hub.group.review',
        featured: true,
        badge: true,
      },
      {
        labelKey: 'nav.dataQuality',
        descriptionKey: 'nav.desc.dataQuality',
        icon: 'DQ',
        iconName: 'activity',
        link: '/governance/data-quality',
        permission: 'data_quality_issues.view',
        groupKey: 'hub.group.review',
        featured: true,
      },
      {
        labelKey: 'nav.securityGovernance',
        descriptionKey: 'nav.desc.securityGovernance',
        icon: 'SG',
        iconName: 'lock',
        link: '/governance/security',
        permission: 'security_governance.view',
        groupKey: 'hub.group.review',
        featured: true,
      },
      {
        labelKey: 'nav.openData',
        descriptionKey: 'nav.desc.openData',
        icon: 'OD',
        iconName: 'globe',
        link: '/governance/open-data',
        permission: 'open_data_candidates.view',
        groupKey: 'hub.group.evidence',
        featured: true,
      },
      {
        labelKey: 'nav.foi',
        descriptionKey: 'nav.desc.foi',
        icon: 'FI',
        iconName: 'scrollText',
        link: '/governance/foi',
        permission: 'foi_requests.view',
        groupKey: 'hub.group.evidence',
        featured: true,
      },
      {
        labelKey: 'nav.privacyOperations',
        descriptionKey: 'nav.desc.privacyOperations',
        icon: 'PR',
        iconName: 'fingerprint',
        link: '/governance/privacy',
        permission: 'privacy_operations.view',
        groupKey: 'hub.group.evidence',
        featured: true,
      },
      {
        labelKey: 'nav.dataSharing',
        descriptionKey: 'nav.desc.dataSharing',
        icon: 'DS',
        iconName: 'network',
        link: '/governance/data-sharing',
        permission: 'data_sharing_requests.view',
        groupKey: 'hub.group.evidence',
        featured: true,
      },
      {
        labelKey: 'nav.transparencyCockpit',
        descriptionKey: 'nav.desc.transparencyCockpit',
        icon: 'TC',
        iconName: 'dashboard',
        link: '/governance/transparency',
        permission: 'dashboard.view',
        groupKey: 'hub.group.evidence',
        featured: true,
      },
      {
        labelKey: 'nav.reports',
        descriptionKey: 'nav.desc.reports',
        icon: 'RP',
        iconName: 'fileCheck',
        link: '/governance/reports',
        permission: 'dashboard.view',
        groupKey: 'hub.group.evidence',
      },
      {
        labelKey: 'nav.ndi',
        descriptionKey: 'nav.desc.ndi',
        icon: 'ND',
        iconName: 'fileCheck',
        link: '/governance/ndi',
        permission: 'ndi_specifications.view',
        groupKey: 'hub.group.evidence',
      },
      {
        labelKey: 'nav.ndiReadiness',
        descriptionKey: 'nav.desc.ndiReadiness',
        icon: 'NR',
        iconName: 'gauge',
        link: '/governance/ndi/readiness',
        permission: 'ndi_scoring.view',
        groupKey: 'hub.group.evidence',
      },
      {
        labelKey: 'nav.ndiGaps',
        descriptionKey: 'nav.desc.ndiGaps',
        icon: 'GA',
        iconName: 'searchAlert',
        link: '/governance/ndi/gaps',
        permission: 'ndi_scoring.view',
        groupKey: 'hub.group.evidence',
      },
      {
        labelKey: 'nav.auditPacks',
        descriptionKey: 'nav.desc.auditPacks',
        icon: 'AP',
        iconName: 'fileCheck',
        link: '/governance/ndi/audit-packs',
        permission: 'ndi_audit_packs.view',
        groupKey: 'hub.group.evidence',
        featured: true,
      },
      {
        labelKey: 'nav.extendedDomains',
        descriptionKey: 'nav.desc.extendedDomains',
        icon: 'ED',
        iconName: 'database',
        link: '/governance/extended-domains',
        permission: 'extended_domains.view',
        groupKey: 'hub.group.review',
        featured: true,
      },
      {
        labelKey: 'nav.businessValue',
        descriptionKey: 'nav.desc.businessValue',
        icon: 'BV',
        iconName: 'briefcase',
        link: '/governance/business-value',
        permission: 'business_value.view',
        groupKey: 'hub.group.review',
        featured: true,
      },
      {
        labelKey: 'nav.governanceOperations',
        descriptionKey: 'nav.desc.governanceOperations',
        icon: 'GO',
        iconName: 'workflow',
        link: '/governance/operations',
        permission: 'governance_operations.view',
        groupKey: 'hub.group.review',
        featured: true,
      },
      {
        labelKey: 'nav.training',
        descriptionKey: 'nav.desc.training',
        icon: 'TR',
        iconName: 'graduationCap',
        link: '/governance/training',
        permission: 'training_assignments.view',
        groupKey: 'hub.group.evidence',
      },
    ],
  },
  {
    id: 'accessManagement',
    titleKey: 'nav.section.accessManagement',
    items: [
      {
        labelKey: 'nav.roles',
        descriptionKey: 'nav.desc.roles',
        icon: 'RO',
        iconName: 'keyRound',
        link: '/admin/roles',
        permission: 'roles.view',
        groupKey: 'hub.group.access',
        featured: true,
      },
      {
        labelKey: 'nav.users',
        descriptionKey: 'nav.desc.users',
        icon: 'US',
        iconName: 'users',
        link: '/admin/users',
        permission: 'users.view',
        groupKey: 'hub.group.access',
        featured: true,
      },
      {
        labelKey: 'nav.audit',
        descriptionKey: 'nav.desc.audit',
        icon: 'AU',
        iconName: 'scrollText',
        link: '/admin/audit',
        permission: 'audit.view',
        groupKey: 'hub.group.access',
      },
    ],
  },
  {
    id: 'administration',
    titleKey: 'nav.section.administration',
    summaryKey: 'nav.section.administration.summary',
    homeLink: '/admin',
    icon: 'AD',
    iconName: 'settings',
    items: [
      {
        labelKey: 'nav.people',
        descriptionKey: 'nav.desc.people',
        icon: 'PE',
        iconName: 'contact',
        link: '/admin/people',
        permission: 'people.view',
        groupKey: 'hub.group.organization',
        featured: true,
      },
      {
        labelKey: 'nav.dataDomains',
        descriptionKey: 'nav.desc.dataDomains',
        icon: 'DD',
        iconName: 'network',
        link: '/admin/data-domains',
        permission: 'data_domains.view',
        groupKey: 'hub.group.taxonomy',
      },
      {
        labelKey: 'nav.dataSubjects',
        descriptionKey: 'nav.desc.dataSubjects',
        icon: 'DS',
        iconName: 'fingerprint',
        link: '/admin/data-subjects',
        permission: 'data_subjects.view',
        groupKey: 'hub.group.taxonomy',
      },
      {
        labelKey: 'nav.capabilities',
        descriptionKey: 'nav.desc.capabilities',
        icon: 'BC',
        iconName: 'briefcase',
        link: '/admin/capabilities',
        permission: 'business_capabilities.view',
        groupKey: 'hub.group.organization',
      },
      {
        labelKey: 'nav.orgUnits',
        descriptionKey: 'nav.desc.orgUnits',
        icon: 'OU',
        iconName: 'building',
        link: '/admin/org-units',
        permission: 'org_units.view',
        groupKey: 'hub.group.organization',
      },
      {
        labelKey: 'nav.systems',
        descriptionKey: 'nav.desc.systems',
        icon: 'SY',
        iconName: 'server',
        link: '/admin/systems',
        permission: 'systems.view',
        groupKey: 'hub.group.organization',
      },
      {
        labelKey: 'nav.integrations',
        descriptionKey: 'nav.desc.integrations',
        icon: 'IN',
        iconName: 'plug',
        link: '/admin/integrations',
        permission: 'integrations.view',
        groupKey: 'hub.group.organization',
        featured: true,
      },
      {
        labelKey: 'nav.classifications',
        descriptionKey: 'nav.desc.classifications',
        icon: 'CL',
        iconName: 'tags',
        link: '/admin/classifications',
        permission: 'classifications.view',
        groupKey: 'hub.group.taxonomy',
      },
      {
        labelKey: 'nav.roleTypes',
        descriptionKey: 'nav.desc.roleTypes',
        icon: 'RT',
        iconName: 'idCard',
        link: '/admin/role-types',
        permission: 'role_types.view',
        groupKey: 'hub.group.taxonomy',
      },
      {
        labelKey: 'nav.raci',
        descriptionKey: 'nav.desc.raci',
        icon: 'RA',
        iconName: 'clipboardList',
        link: '/admin/raci-templates',
        permission: 'raci_templates.view',
        groupKey: 'hub.group.taxonomy',
      },
      {
        labelKey: 'nav.statusValues',
        descriptionKey: 'nav.desc.statusValues',
        icon: 'ST',
        iconName: 'listCheck',
        link: '/admin/status-values',
        permission: 'status_values.view',
        groupKey: 'hub.group.taxonomy',
      },
    ],
  },
];

export const HUB_CONFIGS: HubConfig[] = [
  {
    id: 'governance',
    sectionIds: ['governance'],
    eyebrowKey: 'hub.governance.eyebrow',
    titleKey: 'hub.governance.title',
    subtitleKey: 'hub.governance.subtitle',
    checklistTitleKey: 'hub.governance.checklistTitle',
    checklistKeys: [
      'hub.governance.check.ownership',
      'hub.governance.check.exceptions',
      'hub.governance.check.evidence',
    ],
  },
  {
    id: 'administration',
    sectionIds: ['accessManagement', 'administration'],
    eyebrowKey: 'hub.admin.eyebrow',
    titleKey: 'hub.admin.title',
    subtitleKey: 'hub.admin.subtitle',
    checklistTitleKey: 'hub.admin.checklistTitle',
    checklistKeys: [
      'hub.admin.check.people',
      'hub.admin.check.access',
      'hub.admin.check.taxonomy',
    ],
  },
];

export const CRUMB_MAP: Record<string, string> = {
  '/dashboard': 'nav.dashboard',
  '/about': 'nav.about',
  '/governance-map': 'nav.designSystem',
  '/design-system': 'nav.designSystem',
  '/assets': 'nav.dataAssets',
  '/governance/ownership': 'nav.ownership',
  '/governance/assignment-rules': 'nav.assignmentRules',
  '/governance/exception-queue': 'nav.exceptions',
  '/governance/workflow': 'nav.workflow',
  '/governance/ndi/readiness': 'nav.ndiReadiness',
  '/governance/ndi/gaps': 'nav.ndiGaps',
  '/governance/ndi/audit-packs': 'nav.auditPacks',
  '/governance/extended-domains': 'nav.extendedDomains',
  '/governance/business-value': 'nav.businessValue',
  '/governance/operations': 'nav.governanceOperations',
  '/governance/ndi': 'nav.ndi',
  '/governance/training': 'nav.training',
  '/governance/data-quality': 'nav.dataQuality',
  '/governance/security': 'nav.securityGovernance',
  '/governance/open-data': 'nav.openData',
  '/governance/foi': 'nav.foi',
  '/governance/privacy': 'nav.privacyOperations',
  '/governance/data-sharing': 'nav.dataSharing',
  '/governance/transparency': 'nav.transparencyCockpit',
  '/governance/reports': 'nav.reports',
  '/governance': 'nav.section.governance',
  '/admin/people': 'nav.people',
  '/admin/roles': 'nav.roles',
  '/admin/users': 'nav.users',
  '/admin/audit': 'nav.audit',
  '/admin/integrations': 'nav.integrations',
  '/admin/data-domains': 'nav.dataDomains',
  '/admin/data-subjects': 'nav.dataSubjects',
  '/admin/capabilities': 'nav.capabilities',
  '/admin/org-units': 'nav.orgUnits',
  '/admin/systems': 'nav.systems',
  '/admin/classifications': 'nav.classifications',
  '/admin/role-types': 'nav.roleTypes',
  '/admin/raci-templates': 'nav.raci',
  '/admin/status-values': 'nav.statusValues',
  '/admin': 'nav.section.administration',
};
