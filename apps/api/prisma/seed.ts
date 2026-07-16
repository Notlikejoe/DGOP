import { join } from 'node:path';
import * as dotenv from 'dotenv';

// Load the single root .env (two levels up from apps/api/prisma).
dotenv.config({ path: join(__dirname, '..', '..', '..', '.env') });

import bcrypt from 'bcryptjs';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

const roles = [
  { code: 'system_admin', nameEn: 'System Administrator', nameAr: 'مدير النظام' },
  { code: 'dmo_admin', nameEn: 'DMO Admin', nameAr: 'مدير مكتب إدارة البيانات' },
  { code: 'data_owner', nameEn: 'Data Owner', nameAr: 'مالك البيانات' },
  { code: 'business_steward', nameEn: 'Business Steward', nameAr: 'أمين البيانات (الأعمال)' },
  { code: 'technical_steward', nameEn: 'Technical Steward', nameAr: 'أمين البيانات (التقني)' },
  { code: 'operational_data_steward', nameEn: 'Operational Data Steward', nameAr: 'أمين البيانات التشغيلي' },
  { code: 'project_data_steward', nameEn: 'Project Data Steward', nameAr: 'أمين بيانات المشروع' },
  { code: 'enterprise_data_steward', nameEn: 'Enterprise Data Steward', nameAr: 'أمين بيانات المؤسسة' },
  { code: 'dq_steward', nameEn: 'Data Quality Steward', nameAr: 'أمين جودة البيانات' },
  { code: 'privacy_officer', nameEn: 'Privacy Officer', nameAr: 'مسؤول الخصوصية' },
  { code: 'security_reviewer', nameEn: 'Security Reviewer', nameAr: 'مراجع الأمن' },
  { code: 'od_officer', nameEn: 'Open Data Officer', nameAr: 'مسؤول البيانات المفتوحة' },
  { code: 'foi_officer', nameEn: 'FOI Officer', nameAr: 'مسؤول حرية المعلومات' },
  { code: 'ndi_evidence_owner', nameEn: 'NDI Evidence Owner', nameAr: 'مالك أدلة المؤشر الوطني' },
  { code: 'auditor', nameEn: 'Auditor', nameAr: 'مدقق' },
  { code: 'executive', nameEn: 'Executive', nameAr: 'تنفيذي' },
];

// Resources whose screens support full CRUD administration.
const ADMIN_RESOURCES = [
  'users',
  'roles',
  'data_domains',
  'data_subjects',
  'business_capabilities',
  'org_units',
  'systems',
  'classifications',
  'role_types',
  'raci_templates',
  'status_values',
  'data_assets',
  'people',
  'assignments',
  'assignment_rules',
  'workflow_cases',
  'workflow_tasks',
  'ndi_specifications',
  'training_courses',
  'training_requirements',
  'training_assignments',
  'certification_tracks',
  'certification_attempts',
  'ce_activities',
  'community_articles',
  'expert_profiles',
  'mentorship_pairs',
  'data_quality_issues',
  'data_quality_rules',
  'data_quality_profiles',
  'security_governance',
  'masking_policies',
  'role_data_access_maps',
  'access_reviews',
  'dlp_incidents',
  'classification_change_requests',
  'integrations',
  'open_data_candidates',
  'foi_requests',
  'foi_disclosures',
  'foi_appeals',
  'privacy_operations',
  'privacy_legal_bases',
  'privacy_ropa_records',
  'privacy_dpias',
  'privacy_dsr_requests',
  'privacy_breaches',
  'data_sharing_requests',
  'data_sharing_agreements',
  'ndi_audit_packs',
  'extended_domains',
  'business_value',
  'governance_operations',
];
const CRUD_ACTIONS = ['view', 'create', 'edit', 'delete'];

// Canonical permission catalog (resource + action pairs).
const permissionCatalog: { resource: string; action: string }[] = [
  { resource: 'dashboard', action: 'view' },
  { resource: 'design_system', action: 'view' },
  { resource: 'audit', action: 'view' },
  // Bulk CSV import is a distinct, higher-privilege action on data assets.
  { resource: 'data_assets', action: 'import' },
  // Bulk CSV import of NDI specifications.
  { resource: 'ndi_specifications', action: 'import' },
  // NDI evidence repository (review instead of edit, so not a standard CRUD resource).
  { resource: 'evidence', action: 'view' },
  { resource: 'evidence', action: 'create' },
  { resource: 'evidence', action: 'review' },
  { resource: 'evidence', action: 'delete' },
  // NDI scoring & gap analysis (read-only readiness views).
  { resource: 'ndi_scoring', action: 'view' },
  // Audit-pack packaging needs explicit generate/download actions.
  { resource: 'ndi_audit_packs', action: 'generate' },
  { resource: 'ndi_audit_packs', action: 'download' },
  // Bulk CSV import of data quality issues.
  { resource: 'data_quality_issues', action: 'import' },
  // Catalog and external tool integration operations.
  { resource: 'integrations', action: 'run' },
  { resource: 'integrations', action: 'writeback' },
  { resource: 'governance_operations', action: 'run' },
  ...ADMIN_RESOURCES.flatMap((r) => CRUD_ACTIONS.map((a) => ({ resource: r, action: a }))),
];

const BASE_PERMS = ['dashboard.view', 'design_system.view'];
const ADMIN_ALL = ADMIN_RESOURCES.flatMap((r) => CRUD_ACTIONS.map((a) => `${r}.${a}`));

// Default role -> permission keys. system_admin receives the full catalog.
const rolePermissionMap: Record<string, string[]> = {
  dmo_admin: [
    ...BASE_PERMS,
    ...ADMIN_ALL,
    'data_assets.import',
    'ndi_specifications.import',
    'evidence.view',
    'evidence.create',
    'evidence.review',
    'evidence.delete',
    'ndi_scoring.view',
    'ndi_audit_packs.generate',
    'ndi_audit_packs.download',
    'data_quality_issues.import',
    'integrations.run',
    'integrations.writeback',
    'governance_operations.run',
    'audit.view',
  ],
  business_steward: [
    ...BASE_PERMS,
    'data_assets.view',
    'assignments.view',
    'workflow_cases.view',
    'workflow_tasks.view',
    'ndi_specifications.view',
    'extended_domains.view',
    'business_value.view',
    'business_value.create',
    'business_value.edit',
    'governance_operations.view',
    'training_courses.view',
    'training_assignments.view',
    'training_assignments.edit',
    'certification_tracks.view',
    'certification_attempts.view',
    'certification_attempts.create',
    'ce_activities.view',
    'ce_activities.create',
    'community_articles.view',
    'expert_profiles.view',
    'mentorship_pairs.view',
  ],
  data_owner: [
    ...BASE_PERMS,
    'data_assets.view',
    'assignments.view',
    'workflow_cases.view',
    'workflow_tasks.view',
    'security_governance.view',
    'access_reviews.view',
    'access_reviews.edit',
    'open_data_candidates.view',
    'open_data_candidates.create',
    'open_data_candidates.edit',
    'privacy_operations.view',
    'data_sharing_requests.view',
    'data_sharing_requests.edit',
    'extended_domains.view',
    'business_value.view',
    'business_value.create',
    'business_value.edit',
    'governance_operations.view',
    'training_courses.view',
    'training_assignments.view',
    'training_assignments.edit',
    'certification_tracks.view',
    'certification_attempts.view',
    'certification_attempts.create',
    'ce_activities.view',
    'ce_activities.create',
    'community_articles.view',
    'expert_profiles.view',
    'mentorship_pairs.view',
  ],
  technical_steward: [
    ...BASE_PERMS,
    'data_assets.view',
    'assignments.view',
    'workflow_cases.view',
    'workflow_tasks.view',
    'extended_domains.view',
    'extended_domains.create',
    'extended_domains.edit',
    'business_value.view',
    'business_value.create',
    'business_value.edit',
    'governance_operations.view',
    'training_courses.view',
    'training_assignments.view',
    'training_assignments.edit',
    'certification_tracks.view',
    'certification_attempts.view',
    'certification_attempts.create',
    'ce_activities.view',
    'ce_activities.create',
    'community_articles.view',
    'expert_profiles.view',
    'mentorship_pairs.view',
  ],
  operational_data_steward: [
    ...BASE_PERMS,
    'data_assets.view',
    'assignments.view',
    'workflow_cases.view',
    'workflow_tasks.view',
    'extended_domains.view',
    'business_value.view',
    'business_value.create',
    'governance_operations.view',
    'training_courses.view',
    'training_assignments.view',
    'training_assignments.edit',
    'certification_tracks.view',
    'certification_attempts.view',
    'certification_attempts.create',
    'ce_activities.view',
    'ce_activities.create',
    'community_articles.view',
    'expert_profiles.view',
    'mentorship_pairs.view',
  ],
  project_data_steward: [
    ...BASE_PERMS,
    'data_assets.view',
    'assignments.view',
    'workflow_cases.view',
    'workflow_tasks.view',
    'extended_domains.view',
    'extended_domains.create',
    'extended_domains.edit',
    'business_value.view',
    'business_value.create',
    'business_value.edit',
    'governance_operations.view',
    'training_courses.view',
    'training_assignments.view',
    'training_assignments.edit',
    'certification_tracks.view',
    'certification_attempts.view',
    'certification_attempts.create',
    'ce_activities.view',
    'ce_activities.create',
    'community_articles.view',
    'expert_profiles.view',
    'mentorship_pairs.view',
  ],
  enterprise_data_steward: [
    ...BASE_PERMS,
    'data_assets.view',
    'people.view',
    'assignments.view',
    'workflow_cases.view',
    'workflow_tasks.view',
    'ndi_specifications.view',
    'ndi_scoring.view',
    'ndi_audit_packs.view',
    'extended_domains.view',
    'extended_domains.create',
    'extended_domains.edit',
    'business_value.view',
    'business_value.create',
    'business_value.edit',
    'governance_operations.view',
    'governance_operations.run',
    'security_governance.view',
    'access_reviews.view',
    'open_data_candidates.view',
    'training_courses.view',
    'training_requirements.view',
    'training_assignments.view',
    'training_assignments.edit',
    'certification_tracks.view',
    'certification_attempts.view',
    'certification_attempts.create',
    'ce_activities.view',
    'ce_activities.create',
    'community_articles.view',
    'community_articles.create',
    'expert_profiles.view',
    'expert_profiles.create',
    'mentorship_pairs.view',
    'mentorship_pairs.create',
  ],
  dq_steward: [
    ...BASE_PERMS,
    'data_assets.view',
    'people.view',
    'assignments.view',
    'workflow_cases.view',
    'workflow_cases.create',
    'workflow_cases.edit',
    'workflow_tasks.view',
    'workflow_tasks.create',
    'workflow_tasks.edit',
    'data_quality_issues.view',
    'data_quality_issues.create',
    'data_quality_issues.edit',
    'data_quality_issues.import',
    'data_quality_rules.view',
    'data_quality_rules.create',
    'data_quality_rules.edit',
    'data_quality_profiles.view',
    'data_quality_profiles.create',
    'governance_operations.view',
    'training_assignments.view',
    'training_assignments.edit',
    'certification_tracks.view',
    'certification_attempts.view',
    'certification_attempts.create',
    'ce_activities.view',
    'ce_activities.create',
    'community_articles.view',
    'expert_profiles.view',
    'mentorship_pairs.view',
  ],
  auditor: [
    ...BASE_PERMS,
    'data_assets.view',
    'people.view',
    'assignments.view',
    'assignment_rules.view',
    'workflow_cases.view',
    'workflow_tasks.view',
    'ndi_specifications.view',
    'evidence.view',
    'ndi_scoring.view',
    'ndi_audit_packs.view',
    'ndi_audit_packs.download',
    'extended_domains.view',
    'business_value.view',
    'governance_operations.view',
    'training_courses.view',
    'training_requirements.view',
    'training_assignments.view',
    'certification_tracks.view',
    'certification_attempts.view',
    'ce_activities.view',
    'community_articles.view',
    'expert_profiles.view',
    'mentorship_pairs.view',
    'data_quality_issues.view',
    'data_quality_rules.view',
    'data_quality_profiles.view',
    'security_governance.view',
    'masking_policies.view',
    'role_data_access_maps.view',
    'access_reviews.view',
    'dlp_incidents.view',
    'classification_change_requests.view',
    'integrations.view',
    'open_data_candidates.view',
    'audit.view',
    'privacy_operations.view',
    'privacy_legal_bases.view',
    'privacy_ropa_records.view',
    'privacy_dpias.view',
    'privacy_dsr_requests.view',
    'privacy_breaches.view',
    'data_sharing_requests.view',
    'data_sharing_agreements.view',
    'governance_operations.view',
  ],
  privacy_officer: [
    ...BASE_PERMS,
    'data_assets.view',
    'people.view',
    'roles.view',
    'classifications.view',
    'security_governance.view',
    'security_governance.create',
    'security_governance.edit',
    'masking_policies.view',
    'masking_policies.create',
    'masking_policies.edit',
    'role_data_access_maps.view',
    'access_reviews.view',
    'access_reviews.edit',
    'dlp_incidents.view',
    'dlp_incidents.create',
    'dlp_incidents.edit',
    'classification_change_requests.view',
    'classification_change_requests.create',
    'classification_change_requests.edit',
    'integrations.view',
    'integrations.run',
    'integrations.writeback',
    'open_data_candidates.view',
    'privacy_operations.view',
    'privacy_operations.create',
    'privacy_operations.edit',
    'privacy_legal_bases.view',
    'privacy_legal_bases.create',
    'privacy_legal_bases.edit',
    'privacy_ropa_records.view',
    'privacy_ropa_records.create',
    'privacy_ropa_records.edit',
    'privacy_dpias.view',
    'privacy_dpias.create',
    'privacy_dpias.edit',
    'privacy_dsr_requests.view',
    'privacy_dsr_requests.create',
    'privacy_dsr_requests.edit',
    'privacy_breaches.view',
    'privacy_breaches.create',
    'privacy_breaches.edit',
    'data_sharing_requests.view',
    'data_sharing_requests.create',
    'data_sharing_requests.edit',
    'data_sharing_agreements.view',
    'governance_operations.view',
    'audit.view',
  ],
  od_officer: [
    ...BASE_PERMS,
    'data_assets.view',
    'people.view',
    'classifications.view',
    'assignments.view',
    'workflow_cases.view',
    'workflow_tasks.view',
    'data_quality_issues.view',
    'data_quality_rules.view',
    'data_quality_profiles.view',
    'security_governance.view',
    'open_data_candidates.view',
    'open_data_candidates.create',
    'open_data_candidates.edit',
    'open_data_candidates.delete',
    'privacy_operations.view',
    'data_sharing_requests.view',
    'data_sharing_agreements.view',
    'governance_operations.view',
    'audit.view',
  ],
  foi_officer: [
    ...BASE_PERMS,
    'data_assets.view',
    'people.view',
    'classifications.view',
    'workflow_cases.view',
    'workflow_tasks.view',
    'governance_operations.view',
    'foi_requests.view',
    'foi_requests.create',
    'foi_requests.edit',
    'foi_disclosures.view',
    'foi_disclosures.create',
    'foi_appeals.view',
    'foi_appeals.create',
    'audit.view',
  ],
  security_reviewer: [
    ...BASE_PERMS,
    'data_assets.view',
    'people.view',
    'users.view',
    'roles.view',
    'classifications.view',
    'security_governance.view',
    'security_governance.create',
    'security_governance.edit',
    'masking_policies.view',
    'role_data_access_maps.view',
    'role_data_access_maps.create',
    'role_data_access_maps.edit',
    'access_reviews.view',
    'access_reviews.create',
    'access_reviews.edit',
    'dlp_incidents.view',
    'dlp_incidents.create',
    'dlp_incidents.edit',
    'classification_change_requests.view',
    'classification_change_requests.edit',
    'privacy_operations.view',
    'privacy_breaches.view',
    'privacy_breaches.edit',
    'data_sharing_requests.view',
    'data_sharing_requests.edit',
    'data_sharing_agreements.view',
    'data_sharing_agreements.edit',
    'governance_operations.view',
    'audit.view',
  ],
  ndi_evidence_owner: [
    ...BASE_PERMS,
    'ndi_specifications.view',
    'evidence.view',
    'evidence.create',
    'ndi_audit_packs.view',
    'governance_operations.view',
    'training_courses.view',
    'training_assignments.view',
    'training_assignments.edit',
    'certification_tracks.view',
    'certification_attempts.view',
    'ce_activities.view',
    'ce_activities.create',
    'community_articles.view',
    'expert_profiles.view',
    'mentorship_pairs.view',
  ],
};

const classifications = [
  { code: 'public', nameEn: 'Public', nameAr: 'عام', rank: 1, color: '#1a7f4b' },
  { code: 'internal', nameEn: 'Internal', nameAr: 'داخلي', rank: 2, color: '#1f6feb' },
  { code: 'restricted', nameEn: 'Restricted', nameAr: 'مقيّد', rank: 3, color: '#b5790a' },
  { code: 'secret', nameEn: 'Secret', nameAr: 'سري', rank: 4, color: '#c0392b' },
  { code: 'top_secret', nameEn: 'Top Secret', nameAr: 'سري للغاية', rank: 5, color: '#6b1414' },
];

const roleTypes = [
  { code: 'data_owner', nameEn: 'Data Owner', nameAr: 'مالك البيانات' },
  { code: 'business_steward', nameEn: 'Business Steward', nameAr: 'أمين البيانات (الأعمال)' },
  { code: 'technical_steward', nameEn: 'Technical Steward', nameAr: 'أمين البيانات (التقني)' },
  { code: 'operational_data_steward', nameEn: 'Operational Data Steward', nameAr: 'أمين البيانات التشغيلي' },
  { code: 'project_data_steward', nameEn: 'Project Data Steward', nameAr: 'أمين بيانات المشروع' },
  { code: 'enterprise_data_steward', nameEn: 'Enterprise Data Steward', nameAr: 'أمين بيانات المؤسسة' },
  { code: 'dq_steward', nameEn: 'Data Quality Steward', nameAr: 'أمين جودة البيانات' },
  { code: 'data_custodian', nameEn: 'Data Custodian', nameAr: 'حافظ البيانات' },
];

const statusValues = [
  { domain: 'workflow', code: 'draft', nameEn: 'Draft', nameAr: 'مسودة', color: '#6b7280', sortOrder: 1 },
  { domain: 'workflow', code: 'submitted', nameEn: 'Submitted', nameAr: 'مُقدَّم', color: '#1f6feb', sortOrder: 2 },
  { domain: 'workflow', code: 'under_review', nameEn: 'Under Review', nameAr: 'قيد المراجعة', color: '#b5790a', sortOrder: 3 },
  { domain: 'workflow', code: 'approved', nameEn: 'Approved', nameAr: 'مُعتمد', color: '#1a7f4b', sortOrder: 4 },
  { domain: 'workflow', code: 'rejected', nameEn: 'Rejected', nameAr: 'مرفوض', color: '#c0392b', sortOrder: 5 },
  { domain: 'compliance', code: 'on_track', nameEn: 'On Track', nameAr: 'على المسار', color: '#1a7f4b', sortOrder: 1 },
  { domain: 'compliance', code: 'at_risk', nameEn: 'At Risk', nameAr: 'معرّض للخطر', color: '#b5790a', sortOrder: 2 },
  { domain: 'compliance', code: 'overdue', nameEn: 'Overdue', nameAr: 'متأخر', color: '#c0392b', sortOrder: 3 },
  // Lifecycle states for governed data assets (Sprint 4).
  { domain: 'lifecycle', code: 'draft', nameEn: 'Draft', nameAr: 'مسودة', color: '#6b7280', sortOrder: 1 },
  { domain: 'lifecycle', code: 'active', nameEn: 'Active', nameAr: 'نشِط', color: '#1a7f4b', sortOrder: 2 },
  { domain: 'lifecycle', code: 'deprecated', nameEn: 'Deprecated', nameAr: 'مُهمَل', color: '#b5790a', sortOrder: 3 },
  { domain: 'lifecycle', code: 'retired', nameEn: 'Retired', nameAr: 'مُتقاعد', color: '#c0392b', sortOrder: 4 },
];

const ndiDomains = [
  { code: 'data_strategy', shortCode: 'DG', nameEn: 'Data Strategy & Governance', nameAr: 'استراتيجية وحوكمة البيانات', sortOrder: 1 },
  { code: 'data_catalog', shortCode: 'DCM', nameEn: 'Data Catalog & Metadata', nameAr: 'فهرس البيانات والبيانات الوصفية', sortOrder: 2 },
  { code: 'data_quality', shortCode: 'DQ', nameEn: 'Data Quality', nameAr: 'جودة البيانات', sortOrder: 3 },
  { code: 'data_architecture', shortCode: 'DA', nameEn: 'Data Architecture', nameAr: 'بنية البيانات', sortOrder: 4 },
  { code: 'data_security', shortCode: 'DSI', nameEn: 'Data Security & Protection', nameAr: 'أمن وحماية البيانات', sortOrder: 5 },
  { code: 'data_privacy', shortCode: 'PDP', nameEn: 'Personal Data Protection', nameAr: 'حماية البيانات الشخصية', sortOrder: 6 },
  { code: 'data_sharing', shortCode: 'DSh', nameEn: 'Data Sharing & Integration', nameAr: 'مشاركة وتكامل البيانات', sortOrder: 7 },
  { code: 'open_data', shortCode: 'OD', nameEn: 'Open Data', nameAr: 'البيانات المفتوحة', sortOrder: 8 },
  { code: 'freedom_of_information', shortCode: 'FOI', nameEn: 'Freedom of Information', nameAr: 'حرية المعلومات', sortOrder: 9 },
  { code: 'data_classification', shortCode: 'DC', nameEn: 'Data Classification', nameAr: 'تصنيف البيانات', sortOrder: 10 },
  { code: 'reference_master_data', shortCode: 'RMD', nameEn: 'Reference & Master Data', nameAr: 'البيانات المرجعية والرئيسية', sortOrder: 11 },
  { code: 'data_lifecycle', shortCode: 'DLM', nameEn: 'Data Lifecycle & Retention', nameAr: 'دورة حياة البيانات والاحتفاظ', sortOrder: 12 },
];

// Sample NDI specifications (linked to NDI domains by domain code).
const ndiSpecifications: {
  code: string;
  domainCode: string;
  criterion?: string;
  type: string;
  maturityLevel: string;
  nameEn: string;
  nameAr: string;
  descriptionEn?: string;
  acceptanceCriteria?: string;
  reference?: string;
  sortOrder?: number;
}[] = [
  {
    code: 'DG.1.1',
    domainCode: 'data_strategy',
    criterion: 'Governance Operating Model',
    type: 'policy',
    maturityLevel: 'level_1',
    nameEn: 'Approved data governance policy',
    nameAr: 'سياسة حوكمة بيانات معتمدة',
    descriptionEn: 'An entity-wide data governance policy is documented, approved and published.',
    acceptanceCriteria: 'Signed policy document exists and is communicated to staff.',
    reference: 'NDI DG-01',
    sortOrder: 1,
  },
  {
    code: 'DG.1.2',
    domainCode: 'data_strategy',
    criterion: 'Roles & Responsibilities',
    type: 'standard',
    maturityLevel: 'level_2',
    nameEn: 'Defined data ownership and stewardship roles',
    nameAr: 'تعريف أدوار ملكية وأمانة البيانات',
    descriptionEn: 'Data owners and stewards are assigned for governed data assets.',
    acceptanceCriteria: 'Ownership registry lists an approved data owner for each critical asset.',
    reference: 'NDI DG-04',
    sortOrder: 2,
  },
  {
    code: 'CAT.1.1',
    domainCode: 'data_catalog',
    criterion: 'Metadata Management',
    type: 'standard',
    maturityLevel: 'level_2',
    nameEn: 'Maintained data catalog with business metadata',
    nameAr: 'فهرس بيانات محدّث يحتوي البيانات الوصفية',
    descriptionEn: 'Governed data assets are registered with descriptive business metadata.',
    acceptanceCriteria: 'Catalog coverage of critical assets is at least 80%.',
    reference: 'NDI MD-02',
    sortOrder: 1,
  },
  {
    code: 'DQ.1.1',
    domainCode: 'data_quality',
    criterion: 'Quality Controls',
    type: 'control',
    maturityLevel: 'level_2',
    nameEn: 'Data quality rules for critical data elements',
    nameAr: 'قواعد جودة البيانات للعناصر الحرجة',
    descriptionEn: 'Quality rules (completeness, validity) are defined and monitored.',
    acceptanceCriteria: 'Quality rules exist and results are reported periodically.',
    reference: 'NDI DQ-03',
    sortOrder: 1,
  },
  {
    code: 'DQ.2.1',
    domainCode: 'data_quality',
    criterion: 'Issue Remediation',
    type: 'procedure',
    maturityLevel: 'level_3',
    nameEn: 'Data quality issue remediation workflow',
    nameAr: 'سير عمل معالجة مشكلات جودة البيانات',
    descriptionEn: 'Identified quality issues are tracked and remediated through a workflow.',
    acceptanceCriteria: 'Open issues are triaged with owners and target dates.',
    reference: 'NDI DQ-07',
    sortOrder: 2,
  },
  {
    code: 'DSI.1.1',
    domainCode: 'data_sharing',
    criterion: 'Sharing Agreements',
    type: 'standard',
    maturityLevel: 'level_2',
    nameEn: 'Documented data sharing agreements',
    nameAr: 'اتفاقيات مشاركة بيانات موثقة',
    descriptionEn: 'Inter-entity data sharing is governed by approved agreements.',
    acceptanceCriteria: 'Each external data exchange has a signed agreement on file.',
    reference: 'NDI DS-02',
    sortOrder: 1,
  },
  {
    code: 'PDP.1.1',
    domainCode: 'data_privacy',
    criterion: 'Personal Data Inventory',
    type: 'control',
    maturityLevel: 'level_2',
    nameEn: 'Inventory of personal data processing',
    nameAr: 'سجل معالجة البيانات الشخصية',
    descriptionEn: 'Personal data processing activities are inventoried and classified.',
    acceptanceCriteria: 'Records of processing are maintained and reviewed annually.',
    reference: 'NDI PDP-01',
    sortOrder: 1,
  },
  {
    code: 'OD.1.1',
    domainCode: 'open_data',
    criterion: 'Open Data Publishing',
    type: 'guideline',
    maturityLevel: 'level_1',
    nameEn: 'Open data publishing guideline',
    nameAr: 'إرشادات نشر البيانات المفتوحة',
    descriptionEn: 'Eligible datasets are published as open data using approved formats.',
    acceptanceCriteria: 'At least one dataset is published in a machine-readable format.',
    reference: 'NDI OD-01',
    sortOrder: 1,
  },
  {
    code: 'FOI.1.1',
    domainCode: 'freedom_of_information',
    criterion: 'Information Requests',
    type: 'procedure',
    maturityLevel: 'level_1',
    nameEn: 'Freedom of information request handling',
    nameAr: 'إجراء معالجة طلبات حرية المعلومات',
    descriptionEn: 'A documented procedure handles information access requests within SLA.',
    acceptanceCriteria: 'Requests are logged and answered within the mandated period.',
    reference: 'NDI FOI-02',
    sortOrder: 1,
  },
  {
    code: 'CLS.1.1',
    domainCode: 'data_classification',
    criterion: 'Classification Scheme',
    type: 'standard',
    maturityLevel: 'level_2',
    nameEn: 'Applied data classification scheme',
    nameAr: 'تطبيق مخطط تصنيف البيانات',
    descriptionEn: 'Data assets are classified using the approved sensitivity scheme.',
    acceptanceCriteria: 'Critical assets carry a classification label.',
    reference: 'NDI CL-01',
    sortOrder: 1,
  },
];

const dataDomains: { code: string; nameEn: string; nameAr: string; parentCode?: string }[] = [
  { code: 'patient_care', nameEn: 'Patient Care', nameAr: 'رعاية المرضى' },
  { code: 'clinical', nameEn: 'Clinical Data', nameAr: 'البيانات السريرية', parentCode: 'patient_care' },
  { code: 'pharmacy', nameEn: 'Pharmacy', nameAr: 'الصيدلة', parentCode: 'patient_care' },
  { code: 'corporate', nameEn: 'Corporate', nameAr: 'الشؤون المؤسسية' },
  { code: 'finance', nameEn: 'Finance', nameAr: 'المالية', parentCode: 'corporate' },
  { code: 'hr', nameEn: 'Human Resources', nameAr: 'الموارد البشرية', parentCode: 'corporate' },
];

const dataSubjects = [
  { code: 'patient', nameEn: 'Patient', nameAr: 'مريض' },
  { code: 'employee', nameEn: 'Employee', nameAr: 'موظف' },
  { code: 'supplier', nameEn: 'Supplier', nameAr: 'مورّد' },
  { code: 'visitor', nameEn: 'Visitor', nameAr: 'زائر' },
];

const businessCapabilities: { code: string; nameEn: string; nameAr: string; parentCode?: string }[] = [
  { code: 'clinical_ops', nameEn: 'Clinical Operations', nameAr: 'العمليات السريرية' },
  { code: 'inpatient', nameEn: 'Inpatient Care', nameAr: 'الرعاية الداخلية', parentCode: 'clinical_ops' },
  { code: 'outpatient', nameEn: 'Outpatient Care', nameAr: 'الرعاية الخارجية', parentCode: 'clinical_ops' },
  { code: 'corporate_services', nameEn: 'Corporate Services', nameAr: 'الخدمات المؤسسية' },
  { code: 'revenue_cycle', nameEn: 'Revenue Cycle', nameAr: 'دورة الإيرادات', parentCode: 'corporate_services' },
  { code: 'procurement', nameEn: 'Procurement', nameAr: 'المشتريات', parentCode: 'corporate_services' },
];

// Sample governed data assets (link by reference codes; resolved to ids during seeding).
const sampleAssets: {
  code: string;
  nameEn: string;
  nameAr: string;
  description?: string;
  lifecycleStatus: string;
  ownerName?: string;
  domainCode?: string;
  capabilityCode?: string;
  classificationCode?: string;
  subjectCodes?: string[];
}[] = [
  {
    code: 'AST-EMR-PATIENTS',
    nameEn: 'EMR Patient Records',
    nameAr: 'سجلات مرضى النظام الطبي',
    description: 'Master electronic medical records for all registered patients.',
    lifecycleStatus: 'active',
    ownerName: 'Dr. Sara Al-Amri',
    domainCode: 'clinical',
    capabilityCode: 'inpatient',
    classificationCode: 'secret',
    subjectCodes: ['patient'],
  },
  {
    code: 'AST-PHARMACY-DISPENSE',
    nameEn: 'Pharmacy Dispensing Log',
    nameAr: 'سجل صرف الصيدلية',
    description: 'Records of medication dispensed to patients.',
    lifecycleStatus: 'active',
    ownerName: 'Khalid Pharmacy Lead',
    domainCode: 'pharmacy',
    capabilityCode: 'outpatient',
    classificationCode: 'restricted',
    subjectCodes: ['patient'],
  },
  {
    code: 'AST-HR-EMPLOYEES',
    nameEn: 'Employee Directory',
    nameAr: 'دليل الموظفين',
    description: 'Master list of employees with HR attributes.',
    lifecycleStatus: 'active',
    domainCode: 'hr',
    capabilityCode: 'corporate_services',
    classificationCode: 'internal',
    subjectCodes: ['employee'],
  },
  {
    code: 'AST-FIN-INVOICES',
    nameEn: 'Supplier Invoices',
    nameAr: 'فواتير الموردين',
    description: 'Accounts payable invoices received from suppliers.',
    lifecycleStatus: 'draft',
    domainCode: 'finance',
    capabilityCode: 'procurement',
    classificationCode: 'internal',
    subjectCodes: ['supplier'],
  },
  {
    code: 'AST-FIN-REVENUE',
    nameEn: 'Revenue Cycle Ledger',
    nameAr: 'دفتر دورة الإيرادات',
    description: 'Billing and revenue transactions.',
    lifecycleStatus: 'active',
    domainCode: 'finance',
    capabilityCode: 'revenue_cycle',
    classificationCode: 'restricted',
    subjectCodes: ['patient', 'supplier'],
  },
];

// Sample directory of governance actors (people who can be owners/stewards).
const people = [
  { fullNameEn: 'Sara Al-Amri', fullNameAr: 'سارة العامري', email: 'sara.alamri@dgop.local', jobTitle: 'Chief Data Officer', organization: 'Data Governance Office' },
  { fullNameEn: 'Khalid Hassan', fullNameAr: 'خالد حسن', email: 'khalid.hassan@dgop.local', jobTitle: 'Finance Data Owner', organization: 'Finance Department' },
  { fullNameEn: 'Mona Youssef', fullNameAr: 'منى يوسف', email: 'mona.youssef@dgop.local', jobTitle: 'Clinical Business Steward', organization: 'Clinical Services' },
  { fullNameEn: 'Omar Farouk', fullNameAr: 'عمر فاروق', email: 'omar.farouk@dgop.local', jobTitle: 'Technical Steward', organization: 'IT' },
  { fullNameEn: 'Layla Nasser', fullNameAr: 'ليلى ناصر', email: 'layla.nasser@dgop.local', jobTitle: 'HR Data Owner', organization: 'Human Resources' },
];

const sampleUserRoles = [
  { email: 'sara.alamri@dgop.local', roleCodes: ['enterprise_data_steward', 'ndi_evidence_owner', 'privacy_officer', 'od_officer', 'foi_officer'] },
  { email: 'khalid.hassan@dgop.local', roleCodes: ['data_owner'] },
  { email: 'mona.youssef@dgop.local', roleCodes: ['business_steward', 'dq_steward'] },
  { email: 'omar.farouk@dgop.local', roleCodes: ['technical_steward', 'operational_data_steward', 'security_reviewer'] },
  { email: 'layla.nasser@dgop.local', roleCodes: ['data_owner', 'project_data_steward'] },
];

const trainingCourses = [
  {
    code: 'TRN-DG-FOUND',
    titleEn: 'Data Governance Foundations',
    titleAr: 'أساسيات حوكمة البيانات',
    description: 'Core DGOP responsibilities, ownership, evidence, and workflow practices.',
    category: 'fundamentals',
    tier: 'tier_1',
    deliveryMethod: 'self_paced',
    durationMinutes: 45,
    validityMonths: 12,
  },
  {
    code: 'TRN-STEW-CORE',
    titleEn: 'Core Stewardship Skills',
    titleAr: 'مهارات الأمانة الأساسية',
    description: 'Day-to-day stewardship, ownership follow-up, escalation, and evidence hygiene.',
    category: 'core_skills',
    tier: 'tier_2',
    deliveryMethod: 'workshop',
    prerequisiteCode: 'TRN-DG-FOUND',
    durationMinutes: 120,
    validityMonths: 18,
  },
  {
    code: 'TRN-NDI-EVID',
    titleEn: 'NDI Evidence Readiness',
    titleAr: 'جاهزية أدلة المؤشر الوطني',
    description: 'How to prepare, submit, review, and refresh compliance evidence.',
    category: 'compliance',
    tier: 'tier_2',
    deliveryMethod: 'guided_lab',
    prerequisiteCode: 'TRN-DG-FOUND',
    durationMinutes: 35,
    validityMonths: 12,
  },
  {
    code: 'TRN-DQ-OPS',
    titleEn: 'Data Quality Issue Operations',
    titleAr: 'تشغيل معالجة جودة البيانات',
    description: 'Triage, assign, remediate, and close data quality issues through DGOP.',
    category: 'data_quality',
    tier: 'tier_2',
    deliveryMethod: 'guided_lab',
    prerequisiteCode: 'TRN-STEW-CORE',
    durationMinutes: 30,
    validityMonths: 6,
  },
  {
    code: 'TRN-ADV-RCA',
    titleEn: 'Advanced Root Cause and Remediation',
    titleAr: 'تحليل الأسباب الجذرية والمعالجة المتقدمة',
    description: 'Advanced data issue investigation, control design, recurrence prevention, and case closure.',
    category: 'advanced',
    tier: 'tier_3',
    deliveryMethod: 'case_lab',
    prerequisiteCode: 'TRN-DQ-OPS',
    durationMinutes: 180,
    validityMonths: 18,
  },
  {
    code: 'TRN-EVID-AUDIT',
    titleEn: 'Evidence Audit Lab',
    titleAr: 'مختبر تدقيق الأدلة',
    description: 'Audit-ready evidence reviews, finding response, renewal timing, and control traceability.',
    category: 'advanced',
    tier: 'tier_3',
    deliveryMethod: 'case_lab',
    prerequisiteCode: 'TRN-NDI-EVID',
    durationMinutes: 150,
    validityMonths: 18,
  },
  {
    code: 'TRN-GOV-LEAD',
    titleEn: 'Governance Leadership and Operating Model',
    titleAr: 'قيادة الحوكمة ونموذج التشغيل',
    description: 'Executive stewardship, governance councils, performance rituals, and value realization.',
    category: 'leadership',
    tier: 'tier_4',
    deliveryMethod: 'cohort',
    prerequisiteCode: 'TRN-ADV-RCA',
    durationMinutes: 180,
    validityMonths: 24,
  },
];

const trainingRequirements = [
  { courseCode: 'TRN-DG-FOUND', roleCode: 'dmo_admin', mandatory: true, dueDays: 14 },
  { courseCode: 'TRN-DG-FOUND', roleCode: 'data_owner', mandatory: true, dueDays: 21 },
  { courseCode: 'TRN-DG-FOUND', roleCode: 'business_steward', mandatory: true, dueDays: 21 },
  { courseCode: 'TRN-DG-FOUND', roleCode: 'technical_steward', mandatory: true, dueDays: 21 },
  { courseCode: 'TRN-STEW-CORE', roleCode: 'data_owner', mandatory: true, dueDays: 30 },
  { courseCode: 'TRN-STEW-CORE', roleCode: 'business_steward', mandatory: true, dueDays: 30 },
  { courseCode: 'TRN-STEW-CORE', roleCode: 'operational_data_steward', mandatory: true, dueDays: 30 },
  { courseCode: 'TRN-STEW-CORE', roleCode: 'project_data_steward', mandatory: true, dueDays: 30 },
  { courseCode: 'TRN-NDI-EVID', roleCode: 'ndi_evidence_owner', mandatory: true, dueDays: 14 },
  { courseCode: 'TRN-EVID-AUDIT', roleCode: 'ndi_evidence_owner', mandatory: true, dueDays: 30 },
  { courseCode: 'TRN-EVID-AUDIT', roleCode: 'auditor', mandatory: true, dueDays: 30 },
  { courseCode: 'TRN-DQ-OPS', roleCode: 'dq_steward', mandatory: true, dueDays: 10 },
  { courseCode: 'TRN-DQ-OPS', roleCode: 'technical_steward', mandatory: true, dueDays: 21 },
  { courseCode: 'TRN-ADV-RCA', roleCode: 'dq_steward', mandatory: true, dueDays: 35 },
  { courseCode: 'TRN-GOV-LEAD', roleCode: 'dmo_admin', mandatory: true, dueDays: 45 },
  { courseCode: 'TRN-GOV-LEAD', roleCode: 'enterprise_data_steward', mandatory: true, dueDays: 45 },
];

const certificationTracks = [
  {
    code: 'CDS',
    level: 'cds',
    nameEn: 'Certified Data Steward',
    nameAr: 'أمين بيانات معتمد',
    description: 'Core certification for operational stewards who manage assignments, issues, and evidence.',
    requiredTier: 'tier_2',
    requiredCeHours: 8,
    validityMonths: 24,
    passScore: 75,
    privileges: 'May own operational stewardship tasks and submit evidence packages.',
  },
  {
    code: 'SDS',
    level: 'sds',
    nameEn: 'Senior Data Steward',
    nameAr: 'أمين بيانات أول',
    description: 'Advanced certification for stewards who lead remediation, reviews, and domain governance rituals.',
    requiredTier: 'tier_3',
    requiredCeHours: 16,
    validityMonths: 24,
    passScore: 80,
    privileges: 'May lead case reviews, mentor stewards, and validate remediation controls.',
  },
  {
    code: 'MDS',
    level: 'mds',
    nameEn: 'Master Data Steward',
    nameAr: 'أمين بيانات خبير',
    description: 'Leadership certification for enterprise stewards who operate the governance model.',
    requiredTier: 'tier_4',
    requiredCeHours: 24,
    validityMonths: 36,
    passScore: 85,
    privileges: 'May chair stewardship reviews, approve capability playbooks, and coach certification candidates.',
  },
];

const certificationAttempts = [
  { trackCode: 'CDS', userEmail: 'mona.youssef@dgop.local', status: 'passed', examScore: 88, caseStudyScore: 84, peerReviewScore: 90, evidenceNote: 'Passed CDS readiness review.' },
  { trackCode: 'CDS', userEmail: 'omar.farouk@dgop.local', status: 'in_progress', examScore: 70, caseStudyScore: null, peerReviewScore: null, evidenceNote: 'Case study pending.' },
  { trackCode: 'SDS', userEmail: 'sara.alamri@dgop.local', status: 'passed', examScore: 91, caseStudyScore: 89, peerReviewScore: 94, evidenceNote: 'Senior steward pathway completed.' },
];

const continuingEducationActivities = [
  { userEmail: 'mona.youssef@dgop.local', titleEn: 'Ownership gap review clinic', titleAr: 'عيادة مراجعة فجوات الملكية', activityType: 'clinic', hours: 4, evidenceNote: 'Attended steward clinic.' },
  { userEmail: 'omar.farouk@dgop.local', titleEn: 'Data quality remediation workshop', titleAr: 'ورشة معالجة جودة البيانات', activityType: 'workshop', hours: 6, evidenceNote: 'Completed remediation workshop.' },
  { userEmail: 'sara.alamri@dgop.local', titleEn: 'Governance council facilitation', titleAr: 'تيسير مجلس الحوكمة', activityType: 'leadership', hours: 8, evidenceNote: 'Led monthly governance council.' },
];

const communityArticles = [
  {
    titleEn: 'How to close an ownership gap',
    titleAr: 'كيفية إغلاق فجوة الملكية',
    summaryEn: 'A simple checklist for confirming owner, steward, evidence, and approval trail.',
    summaryAr: 'قائمة مختصرة لتأكيد المالك والأمين والدليل ومسار الاعتماد.',
    category: 'playbook',
    authorEmail: 'sara.alamri@dgop.local',
    contributionPoints: 40,
    isFeatured: true,
  },
  {
    titleEn: 'Evidence renewal timing',
    titleAr: 'توقيت تجديد الأدلة',
    summaryEn: 'How evidence owners keep NDI proof fresh before readiness reviews.',
    summaryAr: 'كيف يحافظ مالكو الأدلة على حداثة أدلة المؤشر الوطني.',
    category: 'evidence',
    authorEmail: 'mona.youssef@dgop.local',
    contributionPoints: 25,
    isFeatured: false,
  },
];

const expertProfiles = [
  { personEmail: 'sara.alamri@dgop.local', expertiseArea: 'Governance operating model', bio: 'Leads stewardship councils, governance KPIs, and certification coaching.', contributionPoints: 120, mentorshipCapacity: 4, isMentor: true },
  { personEmail: 'mona.youssef@dgop.local', expertiseArea: 'Clinical data stewardship', bio: 'Supports ownership decisions, issue triage, and NDI evidence readiness.', contributionPoints: 76, mentorshipCapacity: 2, isMentor: true },
  { personEmail: 'omar.farouk@dgop.local', expertiseArea: 'Technical controls and data quality', bio: 'Helps stewards connect quality rules, systems, and remediation evidence.', contributionPoints: 64, mentorshipCapacity: 2, isMentor: true },
];

const mentorshipPairs = [
  { mentorEmail: 'sara.alamri@dgop.local', menteeEmail: 'mona.youssef@dgop.local', status: 'active', focusArea: 'Senior steward certification readiness', progressNote: 'Monthly coaching started.' },
  { mentorEmail: 'omar.farouk@dgop.local', menteeEmail: 'layla.nasser@dgop.local', status: 'planned', focusArea: 'Data quality evidence handoff', progressNote: 'Kickoff planned after foundation course.' },
];

const sampleDataQualityIssues = [
  {
    code: 'DQI-SEED-1',
    assetCode: 'AST-EMR-PATIENTS',
    title: 'Missing national ID values in patient records',
    description: 'Sample completeness issue used to demonstrate DQ triage and workflow routing.',
    severity: 'high',
    dimension: 'completeness',
  },
  {
    code: 'DQI-SEED-2',
    assetCode: 'AST-FIN-REVENUE',
    title: 'Revenue posting date mismatch',
    description: 'Sample consistency issue between billing date and ledger posting date.',
    severity: 'medium',
    dimension: 'consistency',
  },
];

const sampleDataQualityRules = [
  {
    code: 'DQR-PAT-NID-COMP',
    nameEn: 'Patient national ID completeness',
    nameAr: 'اكتمال رقم الهوية للمريض',
    description: 'Patient records must carry a national ID unless formally exempted.',
    dimension: 'completeness',
    severity: 'high',
    assetCode: 'AST-EMR-PATIENTS',
    domainCode: 'clinical',
    ownerEmail: 'mona.youssef@dgop.local',
    thresholdExpression: 'missing_national_id_pct <= 2',
    checkFrequency: 'daily',
    impactSummary: 'Incomplete patient identity data increases matching, reporting, and privacy risk.',
    status: 'deployed',
    score: 88,
  },
  {
    code: 'DQR-FIN-POSTING-CONS',
    nameEn: 'Revenue posting date consistency',
    nameAr: 'اتساق تاريخ ترحيل الإيرادات',
    description: 'Billing date and ledger posting date should remain within the approved close window.',
    dimension: 'consistency',
    severity: 'medium',
    assetCode: 'AST-FIN-REVENUE',
    domainCode: 'finance',
    ownerEmail: 'khalid.hassan@dgop.local',
    thresholdExpression: 'posting_date_variance_days <= 3',
    checkFrequency: 'weekly',
    impactSummary: 'Posting drift affects monthly close confidence and NDI evidence quality.',
    status: 'approved',
    score: 76,
  },
  {
    code: 'DQR-SUP-TAX-VALID',
    nameEn: 'Supplier tax number validity',
    nameAr: 'صحة الرقم الضريبي للمورد',
    description: 'Supplier tax identifiers should match the approved numeric format.',
    dimension: 'validity',
    severity: 'medium',
    assetCode: 'AST-FIN-INVOICES',
    domainCode: 'finance',
    ownerEmail: 'khalid.hassan@dgop.local',
    thresholdExpression: 'invalid_tax_number_pct = 0',
    checkFrequency: 'weekly',
    impactSummary: 'Invalid supplier identity data delays procurement and tax reporting.',
    status: 'in_review',
    score: 71,
  },
];

const sampleDataQualityProfiles = [
  {
    source: 'seed_profile',
    assetCode: 'AST-EMR-PATIENTS',
    domainCode: 'clinical',
    rowCount: 420000,
    columns: [
      { columnName: 'national_id', dataType: 'varchar', completenessPct: 84, uniquenessPct: 99, validityPct: 93, pattern: '##########', anomalyCount: 12, recommendation: 'Create completeness rule for missing national IDs.', dimension: 'completeness' },
      { columnName: 'date_of_birth', dataType: 'date', completenessPct: 98, uniquenessPct: 41, validityPct: 96, pattern: 'yyyy-mm-dd', anomalyCount: 3, recommendation: 'Monitor impossible dates and future values.', dimension: 'validity' },
      { columnName: 'mobile_number', dataType: 'varchar', completenessPct: 89, uniquenessPct: 72, validityPct: 88, pattern: '+966#########', anomalyCount: 8, recommendation: 'Suggest phone-format validity rule.', dimension: 'validity' },
    ],
  },
  {
    source: 'seed_profile',
    assetCode: 'AST-FIN-REVENUE',
    domainCode: 'finance',
    rowCount: 86000,
    columns: [
      { columnName: 'invoice_id', dataType: 'varchar', completenessPct: 100, uniquenessPct: 99, validityPct: 99, pattern: 'INV-*', anomalyCount: 1, recommendation: null, dimension: 'uniqueness' },
      { columnName: 'posting_date', dataType: 'date', completenessPct: 96, uniquenessPct: 8, validityPct: 91, pattern: 'yyyy-mm-dd', anomalyCount: 7, recommendation: 'Suggest consistency rule against billing date.', dimension: 'consistency' },
      { columnName: 'amount_sar', dataType: 'decimal', completenessPct: 99, uniquenessPct: 62, validityPct: 94, pattern: 'decimal(18,2)', anomalyCount: 4, recommendation: 'Flag negative values outside approved adjustment types.', dimension: 'accuracy' },
    ],
  },
];

const sampleOpenDataCandidates = [
  {
    code: 'ODC-FIN-INVOICES',
    assetCode: 'AST-FIN-INVOICES',
    titleEn: 'Supplier Invoice Spend Extract',
    titleAr: 'مستخلص إنفاق فواتير الموردين',
    description: 'Candidate open dataset for aggregated supplier spend transparency.',
    status: 'under_review',
    publicationFrequency: 'quarterly',
    publicationFormat: 'csv',
    ownerEmail: 'khalid.hassan@dgop.local',
    stewardEmail: 'omar.farouk@dgop.local',
    reviewerEmail: 'sara.alamri@dgop.local',
    personalDataAssessment: 'aggregated',
    publicationValueScore: 82,
    decisionNote: 'Requires ODIAO confirmation that supplier identifiers are aggregated before portal publication.',
  },
  {
    code: 'ODC-FIN-REVENUE',
    assetCode: 'AST-FIN-REVENUE',
    titleEn: 'Revenue Cycle Public Indicators',
    titleAr: 'مؤشرات عامة لدورة الإيرادات',
    description: 'Candidate indicators for public reporting; currently blocked by restricted classification and personal data review.',
    status: 'assessment',
    publicationFrequency: 'monthly',
    publicationFormat: 'api',
    ownerEmail: 'khalid.hassan@dgop.local',
    stewardEmail: 'mona.youssef@dgop.local',
    reviewerEmail: 'sara.alamri@dgop.local',
    personalDataAssessment: 'sensitive_personal_data',
    publicationValueScore: 76,
    decisionNote: 'Needs classification downgrade or aggregation proof before approval.',
  },
];

const sampleFoiResponseTemplates = [
  {
    code: 'FOI-TPL-APPROVED',
    nameEn: 'Approved disclosure response',
    nameAr: 'Approved disclosure response',
    outcome: 'approved',
    bodyEn: 'Your information request has been approved. The disclosure package is attached or linked below.',
    bodyAr: 'Your information request has been approved. The disclosure package is attached or linked below.',
  },
  {
    code: 'FOI-TPL-PARTIAL',
    nameEn: 'Partial disclosure response',
    nameAr: 'Partial disclosure response',
    outcome: 'partially_approved',
    bodyEn: 'Your request has been partially approved. Restricted sections are withheld with the exemption basis documented.',
    bodyAr: 'Your request has been partially approved. Restricted sections are withheld with the exemption basis documented.',
  },
  {
    code: 'FOI-TPL-REJECTED',
    nameEn: 'Rejected request response',
    nameAr: 'Rejected request response',
    outcome: 'rejected',
    bodyEn: 'Your request cannot be fulfilled as submitted. The reason and appeal path are documented below.',
    bodyAr: 'Your request cannot be fulfilled as submitted. The reason and appeal path are documented below.',
  },
];

const sampleFoiRequests = [
  {
    requestNumber: 'FOI-2026-0001',
    requesterName: 'Abeer Citizen',
    requesterEmail: 'abeer.requester@example.com',
    requesterType: 'individual',
    channel: 'web',
    category: 'statistics',
    subject: 'Monthly supplier payment statistics',
    description: 'Request for aggregated supplier payment statistics for the previous quarter.',
    status: 'under_review',
    assetCode: 'AST-FIN-INVOICES',
    domainCode: 'finance',
    classificationCode: 'internal',
    assignedEmail: 'sara.alamri@dgop.local',
    identityValidated: true,
    contactValidated: true,
  },
  {
    requestNumber: 'FOI-2026-0002',
    requesterName: 'Media Research Desk',
    requesterEmail: 'research@example.com',
    requesterType: 'media',
    channel: 'email',
    category: 'record_request',
    subject: 'Revenue cycle public indicators',
    description: 'Request for the non-sensitive indicators behind the revenue public dashboard.',
    status: 'decision_due',
    assetCode: 'AST-FIN-REVENUE',
    domainCode: 'finance',
    classificationCode: 'restricted',
    assignedEmail: 'sara.alamri@dgop.local',
    identityValidated: true,
    contactValidated: true,
  },
];

const samplePrivacyLegalBases = [
  {
    code: 'public-task',
    nameEn: 'Public task',
    nameAr: 'مهمة عامة',
    category: 'public_task',
    authority: 'PDPL 2023',
    description: 'Processing is necessary for official public-sector duties.',
  },
  {
    code: 'consent',
    nameEn: 'Consent',
    nameAr: 'الموافقة',
    category: 'consent',
    authority: 'PDPL 2023',
    description: 'The data subject has granted specific consent for the stated purpose.',
  },
  {
    code: 'legal-obligation',
    nameEn: 'Legal obligation',
    nameAr: 'التزام نظامي',
    category: 'legal_obligation',
    authority: 'PDPL 2023',
    description: 'Processing is required to meet a legal or regulatory obligation.',
  },
];

const samplePrivacyRopaRecords = [
  {
    processName: 'Supplier payment transparency reporting',
    purpose: 'Maintain an accountable register for quarterly supplier payment transparency indicators.',
    assetCode: 'AST-FIN-INVOICES',
    domainCode: 'finance',
    legalBasisCode: 'public-task',
    ownerEmail: 'khalid.hassan@dgop.local',
    dataSubjects: 'Suppliers, authorized finance staff',
    recipients: 'Finance leadership, ODIAO reviewers',
    retentionSummary: 'Retain reporting evidence for 5 years, then review.',
    status: 'under_review',
  },
];

const samplePrivacyDpias = [
  {
    title: 'Revenue cycle analytics privacy review',
    description: 'DPIA for restricted revenue indicators used by open data, FOI, and data sharing workflows.',
    assetCode: 'AST-FIN-REVENUE',
    domainCode: 'finance',
    legalBasisCode: 'public-task',
    reviewerEmail: 'sara.alamri@dgop.local',
    crossBorderTransfer: false,
    gateStatuses: {
      requirements: 'approved',
      design: 'pending',
      development: 'pending',
      testing: 'pending',
      deployment: 'pending',
    },
  },
];

const samplePrivacyDsrRequests = [
  {
    requesterName: 'Noura Al-Harbi',
    requesterEmail: 'noura.requester@example.com',
    requestType: 'access',
    description: 'Request for access to personal billing records and correction path if inaccurate.',
    assetCode: 'AST-FIN-REVENUE',
    domainCode: 'finance',
    assignedEmail: 'sara.alamri@dgop.local',
    identityValidated: true,
    status: 'in_progress',
  },
];

const samplePrivacyBreaches = [
  {
    title: 'Restricted export sent to wrong internal group',
    description: 'A restricted finance extract was shared with an unintended internal distribution group.',
    assetCode: 'AST-FIN-REVENUE',
    domainCode: 'finance',
    severity: 'high',
    assignedEmail: 'omar.farouk@dgop.local',
    status: 'triage',
  },
];

const sampleDataSharingRequests = [
  {
    requesterOrg: 'Finance Department',
    recipientOrg: 'Planning Analytics Office',
    purpose: 'Share aggregated revenue indicators for quarterly planning models.',
    assetCode: 'AST-FIN-REVENUE',
    domainCode: 'finance',
    legalBasisCode: 'public-task',
    classificationCode: 'restricted',
    maskingPolicyCode: 'MSK-FINANCE-TOKEN',
    consentRequired: false,
    crossBorderTransfer: false,
    reviews: {
      owner: 'approved',
      privacy: 'pending',
      security: 'pending',
      technical: 'pending',
    },
  },
];

const sampleMaskingPolicies = [
  {
    code: 'MSK-PERSONAL-ID',
    nameEn: 'Personal identifier masking',
    nameAr: 'إخفاء معرفات الأشخاص',
    technique: 'dynamic_masking',
    domainCode: 'clinical',
    classificationCode: 'restricted',
    description: 'Shows only the last four characters of national ID and contact values.',
    previewBefore: '1234567890',
    previewAfter: '******7890',
    fieldsJson: { fields: ['national_id', 'mobile_number'], rule: 'show_last_4' },
  },
  {
    code: 'MSK-FINANCE-TOKEN',
    nameEn: 'Finance sensitive value tokenization',
    nameAr: 'ترميز القيم المالية الحساسة',
    technique: 'tokenization',
    domainCode: 'finance',
    classificationCode: 'restricted',
    description: 'Tokenizes supplier and revenue identifiers before broad reporting use.',
    previewBefore: 'SUP-984401',
    previewAfter: 'tok_fin_7f31',
    fieldsJson: { fields: ['supplier_tax_id', 'invoice_id'], rule: 'tokenize' },
  },
];

const sampleRoleDataAccessMaps = [
  {
    roleCode: 'data_owner',
    domainCode: 'finance',
    classificationCode: 'restricted',
    maskingCode: 'MSK-FINANCE-TOKEN',
    personalDataAllowed: true,
    approvalRequired: true,
    businessJustification: 'Finance owners certify restricted finance access for monthly close and audit evidence.',
  },
  {
    roleCode: 'dq_steward',
    domainCode: 'clinical',
    classificationCode: 'restricted',
    maskingCode: 'MSK-PERSONAL-ID',
    personalDataAllowed: false,
    approvalRequired: true,
    businessJustification: 'DQ stewards can diagnose quality patterns with masked identifiers only.',
  },
  {
    roleCode: 'security_reviewer',
    domainCode: 'clinical',
    classificationCode: 'secret',
    maskingCode: 'MSK-PERSONAL-ID',
    personalDataAllowed: true,
    approvalRequired: true,
    businessJustification: 'Security reviewers investigate protection incidents under formal approval.',
  },
];

function accessScopeKey(domainId?: string | null, classificationId?: string | null): string {
  return `domain:${domainId ?? 'all'}|class:${classificationId ?? 'all'}`;
}

const sampleAccessReview = {
  code: 'ARV-SEED-1',
  title: 'Quarterly restricted data access certification',
  description: 'Owners confirm that users still need restricted clinical and finance access.',
  ownerEmail: 'sara.alamri@dgop.local',
  items: [
    {
      userEmail: 'mona.youssef@dgop.local',
      roleCode: 'dq_steward',
      assetCode: 'AST-EMR-PATIENTS',
      domainCode: 'clinical',
      classificationCode: 'restricted',
      decision: 'pending',
      justification: 'Needs owner confirmation for masked quality remediation access.',
    },
    {
      userEmail: 'khalid.hassan@dgop.local',
      roleCode: 'data_owner',
      assetCode: 'AST-FIN-REVENUE',
      domainCode: 'finance',
      classificationCode: 'restricted',
      decision: 'certified',
      justification: 'Finance owner remains accountable for monthly close evidence.',
    },
  ],
};

const sampleDlpIncidents = [
  {
    code: 'DLP-SEED-1',
    title: 'Restricted patient export needs review',
    description: 'A reporting export touched restricted patient fields and requires containment confirmation.',
    severity: 'high',
    status: 'under_review',
    assetCode: 'AST-EMR-PATIENTS',
    classificationCode: 'restricted',
    assignedEmail: 'omar.farouk@dgop.local',
    detectionSource: 'DLP monitor',
  },
];

const sampleClassificationRequests = [
  {
    assetCode: 'AST-FIN-INVOICES',
    toClassificationCode: 'restricted',
    reason: 'Supplier invoice data includes identifiers that require restricted handling and masking.',
    requestedBy: 'sara.alamri@dgop.local',
  },
];

// Sample assignment rules: "for assets in <scope>, <roleType> is <person>" (by codes/emails).
const assignmentRules: {
  nameEn: string;
  nameAr: string;
  scopeType: 'domain' | 'capability' | 'subject' | 'org_unit' | 'system';
  refCode: string; // resolved against the scope's table by code
  roleTypeCode: string;
  personEmail: string;
  priority?: number;
}[] = [
  { nameEn: 'Finance domain owner', nameAr: 'مالك مجال المالية', scopeType: 'domain', refCode: 'finance', roleTypeCode: 'data_owner', personEmail: 'khalid.hassan@dgop.local' },
  { nameEn: 'Patient Care domain owner', nameAr: 'مالك مجال رعاية المرضى', scopeType: 'domain', refCode: 'patient_care', roleTypeCode: 'data_owner', personEmail: 'sara.alamri@dgop.local' },
  { nameEn: 'Clinical steward', nameAr: 'أمين البيانات السريرية', scopeType: 'domain', refCode: 'clinical', roleTypeCode: 'business_steward', personEmail: 'mona.youssef@dgop.local' },
  { nameEn: 'Clinical DQ steward', nameAr: 'أمين جودة البيانات السريرية', scopeType: 'domain', refCode: 'clinical', roleTypeCode: 'dq_steward', personEmail: 'mona.youssef@dgop.local', priority: 20 },
  { nameEn: 'Finance DQ steward', nameAr: 'أمين جودة البيانات المالية', scopeType: 'domain', refCode: 'finance', roleTypeCode: 'dq_steward', personEmail: 'khalid.hassan@dgop.local', priority: 20 },
  { nameEn: 'HR domain owner', nameAr: 'مالك مجال الموارد البشرية', scopeType: 'domain', refCode: 'hr', roleTypeCode: 'data_owner', personEmail: 'layla.nasser@dgop.local' },
];

// Sample direct assignments on assets (by asset code).
const directAssignments: {
  assetCode: string;
  roleTypeCode: string;
  personEmail: string;
  isPrimary?: boolean;
}[] = [
  { assetCode: 'AST-EMR-PATIENTS', roleTypeCode: 'data_owner', personEmail: 'sara.alamri@dgop.local' },
  { assetCode: 'AST-EMR-PATIENTS', roleTypeCode: 'technical_steward', personEmail: 'omar.farouk@dgop.local' },
];

// Sample asset relationships (by source/target code).
const sampleRelationships: { source: string; target: string; type: string; description?: string }[] = [
  { source: 'AST-FIN-REVENUE', target: 'AST-EMR-PATIENTS', type: 'derived_from', description: 'Billing derives from clinical encounters.' },
  { source: 'AST-PHARMACY-DISPENSE', target: 'AST-EMR-PATIENTS', type: 'related_to', description: 'Dispensing references patient records.' },
];

// Upsert hierarchical reference data, then link parents by code in a second pass.
async function seedHierarchy(
  model: { upsert: Function; findUnique: Function; update: Function },
  items: { code: string; nameEn: string; nameAr: string; parentCode?: string }[],
) {
  for (const it of items) {
    const data = { code: it.code, nameEn: it.nameEn, nameAr: it.nameAr };
    await model.upsert({ where: { code: it.code }, update: { nameEn: it.nameEn, nameAr: it.nameAr }, create: data });
  }
  for (const it of items) {
    if (!it.parentCode) continue;
    const parent = await model.findUnique({ where: { code: it.parentCode } });
    if (parent) await model.update({ where: { code: it.code }, data: { parentId: parent.id } });
  }
}

function addHours(base: Date, hours: number): Date {
  return new Date(base.getTime() + hours * 60 * 60 * 1000);
}

function seedPriority(severity: string): 'P1' | 'P2' | 'P3' | 'P4' {
  if (severity === 'critical') return 'P1';
  if (severity === 'high') return 'P2';
  if (severity === 'medium') return 'P3';
  return 'P4';
}

function seedSlaDates(base: Date, priority: 'P1' | 'P2' | 'P3' | 'P4') {
  const hours = {
    P1: { triage: 4, remediation: 24, validation: 48 },
    P2: { triage: 8, remediation: 48, validation: 72 },
    P3: { triage: 24, remediation: 120, validation: 168 },
    P4: { triage: 72, remediation: 240, validation: 336 },
  }[priority];
  return {
    triageDueAt: addHours(base, hours.triage),
    remediationDueAt: addHours(base, hours.remediation),
    validationDueAt: addHours(base, hours.validation),
  };
}

function seedProfileScore(columns: { completenessPct: number; uniquenessPct: number; validityPct: number; anomalyCount: number; recommendation: string | null }[]) {
  const score = Math.round(
    columns.reduce((sum, column) => sum + column.completenessPct + column.uniquenessPct + column.validityPct, 0) /
      Math.max(1, columns.length * 3),
  );
  return {
    qualityScore: score,
    anomalyCount: columns.reduce((sum, column) => sum + column.anomalyCount, 0),
    recommendedRules: columns.filter((column) => !!column.recommendation).length,
  };
}

async function main() {
  for (const r of roles) {
    await prisma.role.upsert({
      where: { code: r.code },
      update: { ...r, isSystem: true },
      create: { ...r, isSystem: true },
    });
  }
  // Remove any roles that are no longer part of the canonical set.
  await prisma.role.deleteMany({ where: { code: { notIn: roles.map((r) => r.code) } } });
  await prisma.role.updateMany({ where: { code: 'business_steward' }, data: { maxClassificationRank: 2 } });
  await prisma.role.updateMany({ where: { code: 'technical_steward' }, data: { maxClassificationRank: 2 } });
  await prisma.role.updateMany({ where: { code: 'data_owner' }, data: { maxClassificationRank: 3 } });
  await prisma.role.updateMany({ where: { code: 'dq_steward' }, data: { maxClassificationRank: 3 } });
  await prisma.role.updateMany({ where: { code: 'privacy_officer' }, data: { maxClassificationRank: 4 } });
  await prisma.role.updateMany({ where: { code: 'security_reviewer' }, data: { maxClassificationRank: 4 } });

  // Seed the permission catalog.
  const permByKey = new Map<string, string>();
  for (const p of permissionCatalog) {
    const rec = await prisma.permission.upsert({
      where: { resource_action: { resource: p.resource, action: p.action } },
      update: {},
      create: p,
    });
    permByKey.set(`${p.resource}.${p.action}`, rec.id);
  }

  // Prune permissions that are no longer in the canonical catalog
  // (e.g. the retired workflow_tasks.decide permission). Remove their role
  // links first to satisfy the foreign key, then delete the orphan permissions.
  const stalePermissions = await prisma.permission.findMany({
    where: { NOT: { OR: permissionCatalog.map((p) => ({ resource: p.resource, action: p.action })) } },
    select: { id: true, resource: true, action: true },
  });
  if (stalePermissions.length) {
    const staleIds = stalePermissions.map((p) => p.id);
    await prisma.rolePermission.deleteMany({ where: { permissionId: { in: staleIds } } });
    await prisma.permission.deleteMany({ where: { id: { in: staleIds } } });
    console.log(
      `Pruned ${stalePermissions.length} stale permission(s): ${stalePermissions
        .map((p) => `${p.resource}.${p.action}`)
        .join(', ')}`,
    );
  }

  // Assign default permissions to the seeded (system) roles.
  for (const r of roles) {
    const role = await prisma.role.findUnique({ where: { code: r.code } });
    if (!role) continue;
    const keys =
      r.code === 'system_admin'
        ? [...permByKey.keys()]
        : (rolePermissionMap[r.code] ?? BASE_PERMS);
    await prisma.rolePermission.deleteMany({ where: { roleId: role.id } });
    await prisma.rolePermission.createMany({
      data: keys
        .map((k) => permByKey.get(k))
        .filter((id): id is string => !!id)
        .map((permissionId) => ({ roleId: role.id, permissionId })),
      skipDuplicates: true,
    });
  }

  // Seed the initial admin user. Demo passwords are allowed only for local dev/test.
  const seedEnvironment = process.env.NODE_ENV ?? 'development';
  const strictSeed = !['development', 'test'].includes(seedEnvironment);
  const adminEmail = process.env.SEED_ADMIN_EMAIL ?? 'admin@dgop.local';
  const configuredAdminPassword = process.env.SEED_ADMIN_PASSWORD;
  const adminPassword = configuredAdminPassword ?? (strictSeed ? '' : 'Admin@12345');
  if (!adminPassword) {
    throw new Error('SEED_ADMIN_PASSWORD must be set outside development');
  }
  const passwordHash = await bcrypt.hash(adminPassword, 10);
  const admin = await prisma.user.upsert({
    where: { email: adminEmail },
    update: {
      displayName: 'System Administrator',
      isActive: true,
      ...(configuredAdminPassword ? { passwordHash } : {}),
    },
    create: { email: adminEmail, passwordHash, displayName: 'System Administrator', isActive: true },
  });
  const adminRole = await prisma.role.findUnique({ where: { code: 'system_admin' } });
  if (adminRole) {
    await prisma.userRole.upsert({
      where: { userId_roleId: { userId: admin.id, roleId: adminRole.id } },
      update: {},
      create: { userId: admin.id, roleId: adminRole.id },
    });
  }

  for (const c of classifications) {
    await prisma.classification.upsert({ where: { code: c.code }, update: c, create: c });
  }
  // Drop classifications outside the canonical set (e.g. legacy "confidential").
  await prisma.classification.deleteMany({
    where: { code: { notIn: classifications.map((c) => c.code) } },
  });

  for (const rt of roleTypes) {
    await prisma.roleType.upsert({ where: { code: rt.code }, update: rt, create: rt });
  }
  for (const s of statusValues) {
    await prisma.statusValue.upsert({
      where: { domain_code: { domain: s.domain, code: s.code } },
      update: s,
      create: s,
    });
  }
  for (const d of ndiDomains) {
    await prisma.ndiDomain.upsert({ where: { code: d.code }, update: d, create: d });
  }
  const ndiDomainByCode = new Map(
    (await prisma.ndiDomain.findMany()).map((d) => [d.code, d.id]),
  );
  for (const spec of ndiSpecifications) {
    const domainId = ndiDomainByCode.get(spec.domainCode);
    if (!domainId) continue;
    const { domainCode, ...rest } = spec;
    const data = {
      ...rest,
      domainId,
      type: rest.type as never,
      maturityLevel: rest.maturityLevel as never,
    };
    await prisma.ndiSpecification.upsert({
      where: { code: spec.code },
      update: data,
      create: data,
    });
  }

  await seedHierarchy(prisma.dataDomain, dataDomains);
  for (const s of dataSubjects) {
    await prisma.dataSubject.upsert({ where: { code: s.code }, update: s, create: s });
  }
  await seedHierarchy(prisma.businessCapability, businessCapabilities);

  // Seed sample data assets, their subject links, and relationships.
  const domainByCode = new Map(
    (await prisma.dataDomain.findMany()).map((d) => [d.code, d.id]),
  );
  const capabilityByCode = new Map(
    (await prisma.businessCapability.findMany()).map((c) => [c.code, c.id]),
  );
  const classificationByCode = new Map(
    (await prisma.classification.findMany()).map((c) => [c.code, c.id]),
  );
  const subjectByCode = new Map(
    (await prisma.dataSubject.findMany()).map((s) => [s.code, s.id]),
  );

  for (const a of sampleAssets) {
    const data = {
      code: a.code,
      nameEn: a.nameEn,
      nameAr: a.nameAr,
      description: a.description ?? null,
      lifecycleStatus: a.lifecycleStatus,
      ownerName: a.ownerName ?? null,
      ownerStatus: a.ownerName ? 'assigned' : 'unassigned',
      domainId: a.domainCode ? (domainByCode.get(a.domainCode) ?? null) : null,
      capabilityId: a.capabilityCode ? (capabilityByCode.get(a.capabilityCode) ?? null) : null,
      classificationId: a.classificationCode ? (classificationByCode.get(a.classificationCode) ?? null) : null,
    };
    const asset = await prisma.dataAsset.upsert({
      where: { code: a.code },
      update: data,
      create: data,
    });
    // Reset and re-link subjects.
    await prisma.assetSubject.deleteMany({ where: { assetId: asset.id } });
    const subjectIds = (a.subjectCodes ?? [])
      .map((c) => subjectByCode.get(c))
      .filter((id): id is string => !!id);
    if (subjectIds.length) {
      await prisma.assetSubject.createMany({
        data: subjectIds.map((dataSubjectId) => ({ assetId: asset.id, dataSubjectId })),
        skipDuplicates: true,
      });
    }
  }

  const assetByCode = new Map(
    (await prisma.dataAsset.findMany()).map((a) => [a.code, a.id]),
  );

  const catalogConnector = await prisma.integrationConnector.upsert({
    where: { code: 'CATALOG-MVP' },
    update: {
      nameEn: 'Enterprise Catalog',
      nameAr: 'Enterprise Catalog',
      description: 'Sprint 15 catalog connector for CSV and mock REST synchronization.',
      type: 'catalog' as any,
      direction: 'bidirectional' as any,
      status: 'warning' as any,
      sourceTrust: 'authoritative' as any,
      fieldMappingJson: {
        required: ['code', 'nameEn', 'nameAr'],
        optional: ['externalId', 'domainCode', 'orgUnitCode', 'systemCode', 'capabilityCode', 'classificationCode'],
      },
      isActive: true,
      deletedAt: null,
    },
    create: {
      code: 'CATALOG-MVP',
      nameEn: 'Enterprise Catalog',
      nameAr: 'Enterprise Catalog',
      description: 'Sprint 15 catalog connector for CSV and mock REST synchronization.',
      type: 'catalog' as any,
      direction: 'bidirectional' as any,
      status: 'warning' as any,
      sourceTrust: 'authoritative' as any,
      fieldMappingJson: {
        required: ['code', 'nameEn', 'nameAr'],
        optional: ['externalId', 'domainCode', 'orgUnitCode', 'systemCode', 'capabilityCode', 'classificationCode'],
      },
      createdBy: adminEmail,
    },
  });
  await prisma.integrationJob.upsert({
    where: { code: 'JOB-CATALOG-MVP' },
    update: {
      connectorId: catalogConnector.id,
      nameEn: 'Catalog asset synchronization',
      nameAr: 'Catalog asset synchronization',
      jobType: 'catalog_sync' as any,
      status: 'ready' as any,
      syncMode: 'manual',
      isActive: true,
      deletedAt: null,
    },
    create: {
      code: 'JOB-CATALOG-MVP',
      connectorId: catalogConnector.id,
      nameEn: 'Catalog asset synchronization',
      nameAr: 'Catalog asset synchronization',
      jobType: 'catalog_sync' as any,
      status: 'ready' as any,
      syncMode: 'manual',
      createdBy: adminEmail,
    },
  });

  for (const rel of sampleRelationships) {
    const sourceId = assetByCode.get(rel.source);
    const targetId = assetByCode.get(rel.target);
    if (!sourceId || !targetId) continue;
    await prisma.assetRelationship.upsert({
      where: {
        sourceAssetId_targetAssetId_type: {
          sourceAssetId: sourceId,
          targetAssetId: targetId,
          type: rel.type,
        },
      },
      update: { description: rel.description ?? null },
      create: { sourceAssetId: sourceId, targetAssetId: targetId, type: rel.type, description: rel.description ?? null },
    });
  }

  // Seed people; give each a login account (1:1) so they can act in workflows, and link them.
  const dmoRole = await prisma.role.findUnique({ where: { code: 'dmo_admin' } });
  const configuredPersonPassword = process.env.SEED_PERSON_PASSWORD;
  const personPassword = configuredPersonPassword ?? (strictSeed ? '' : 'Password@123');
  if (!personPassword) {
    throw new Error('SEED_PERSON_PASSWORD must be set outside development');
  }
  const personPasswordHash = await bcrypt.hash(personPassword, 10);
  for (const p of people) {
    const user = await prisma.user.upsert({
      where: { email: p.email },
      update: {
        displayName: p.fullNameEn,
        isActive: true,
        ...(configuredPersonPassword ? { passwordHash: personPasswordHash } : {}),
      },
      create: { email: p.email, passwordHash: personPasswordHash, displayName: p.fullNameEn, isActive: true },
    });
    if (dmoRole) {
      await prisma.userRole.upsert({
        where: { userId_roleId: { userId: user.id, roleId: dmoRole.id } },
        update: {},
        create: { userId: user.id, roleId: dmoRole.id },
      });
    }
    await prisma.person.upsert({
      where: { email: p.email },
      update: {
        fullNameEn: p.fullNameEn,
        fullNameAr: p.fullNameAr,
        jobTitle: p.jobTitle,
        organization: p.organization,
        userId: user.id,
      },
      create: { ...p, userId: user.id },
    });
  }
  const personByEmail = new Map(
    (await prisma.person.findMany()).map((p) => [p.email ?? '', p.id]),
  );
  const userByEmail = new Map(
    (await prisma.user.findMany()).map((u) => [u.email, u.id]),
  );
  const systemRoleByCode = new Map((await prisma.role.findMany()).map((r) => [r.code, r.id]));
  for (const entry of sampleUserRoles) {
    const userId = userByEmail.get(entry.email);
    if (!userId) continue;
    for (const code of entry.roleCodes) {
      const roleId = systemRoleByCode.get(code);
      if (!roleId) continue;
      await prisma.userRole.upsert({
        where: { userId_roleId: { userId, roleId } },
        update: {},
        create: { userId, roleId },
      });
    }
  }
  const roleTypeByCode = new Map(
    (await prisma.roleType.findMany()).map((rt) => [rt.code, rt.id]),
  );
  const scopeTableByType: Record<string, Map<string, string>> = {
    domain: domainByCode,
    capability: capabilityByCode,
    subject: subjectByCode,
  };

  for (const r of assignmentRules) {
    const personId = personByEmail.get(r.personEmail);
    const roleTypeId = roleTypeByCode.get(r.roleTypeCode);
    const refId = scopeTableByType[r.scopeType]?.get(r.refCode);
    if (!personId || !roleTypeId || !refId) continue;
    const existing = await prisma.assignmentRule.findFirst({
      where: { scopeType: r.scopeType as any, refId, roleTypeId, deletedAt: null },
    });
    const data = {
      nameEn: r.nameEn,
      nameAr: r.nameAr,
      scopeType: r.scopeType as any,
      refId,
      roleTypeId,
      personId,
      priority: r.priority ?? 100,
    };
    if (existing) await prisma.assignmentRule.update({ where: { id: existing.id }, data });
    else await prisma.assignmentRule.create({ data });
  }

  for (const a of directAssignments) {
    const assetId = assetByCode.get(a.assetCode);
    const personId = personByEmail.get(a.personEmail);
    const roleTypeId = roleTypeByCode.get(a.roleTypeCode);
    if (!assetId || !personId || !roleTypeId) continue;
    const existing = await prisma.stewardshipAssignment.findFirst({
      where: { targetType: 'asset', targetId: assetId, roleTypeId, personId, deletedAt: null },
    });
    if (!existing) {
      await prisma.stewardshipAssignment.create({
        data: { targetType: 'asset', targetId: assetId, roleTypeId, personId, isPrimary: a.isPrimary ?? true, source: 'manual' },
      });
    }
    // Reflect a data owner on the asset's lightweight owner fields.
    if (a.roleTypeCode === 'data_owner') {
      const person = people.find((p) => p.email === a.personEmail);
      await prisma.dataAsset.update({
        where: { id: assetId },
        data: { ownerStatus: 'assigned', ownerName: person?.fullNameEn ?? null },
      });
    }
  }

  // Assign a sample accountable owner to a few NDI specifications (Sprint 9).
  const ownerCandidates = people.map((p) => p.email).filter(Boolean) as string[];
  if (ownerCandidates.length) {
    const specsToOwn = await prisma.ndiSpecification.findMany({
      where: { deletedAt: null },
      orderBy: { code: 'asc' },
      take: 4,
    });
    for (let i = 0; i < specsToOwn.length; i++) {
      const ownerPersonId = personByEmail.get(ownerCandidates[i % ownerCandidates.length]);
      if (!ownerPersonId) continue;
      await prisma.ndiSpecification.update({
        where: { id: specsToOwn[i].id },
        data: { ownerPersonId },
      });
    }
  }

  // Seed a sample owner-assignment approval workflow (pending) to populate the inbox.
  const invoicesId = assetByCode.get('AST-FIN-INVOICES');
  const ownerRoleTypeId = roleTypeByCode.get('data_owner');
  const proposedPersonId = personByEmail.get('khalid.hassan@dgop.local');
  const approverUser = await prisma.user.findUnique({ where: { email: 'sara.alamri@dgop.local' } });
  if (invoicesId && ownerRoleTypeId && proposedPersonId && approverUser) {
    let proposed = await prisma.stewardshipAssignment.findFirst({
      where: {
        targetType: 'asset',
        targetId: invoicesId,
        roleTypeId: ownerRoleTypeId,
        approvalStatus: 'pending',
        deletedAt: null,
      },
    });
    if (!proposed) {
      proposed = await prisma.stewardshipAssignment.create({
        data: {
          targetType: 'asset',
          targetId: invoicesId,
          roleTypeId: ownerRoleTypeId,
          personId: proposedPersonId,
          isPrimary: true,
          source: 'manual',
          approvalStatus: 'pending',
        },
      });
    }
    const existingCase = await prisma.workflowCase.findUnique({ where: { code: 'WFC-SEED-1' } });
    if (!existingCase) {
      const wfCase = await prisma.workflowCase.create({
        data: {
          code: 'WFC-SEED-1',
          title: 'Approve data owner for Supplier Invoices',
          description: 'Proposed: Khalid Hassan as Data Owner of Supplier Invoices.',
          type: 'owner_assignment_approval',
          status: 'submitted',
          assetId: invoicesId,
          assignmentId: proposed.id,
          createdBy: adminEmail,
        },
      });
      const due = new Date();
      due.setDate(due.getDate() + 3);
      const task = await prisma.workflowTask.create({
        data: {
          caseId: wfCase.id,
          title: 'Approve or reject the proposed data owner',
          type: 'approval',
          status: 'pending',
          assigneeUserId: approverUser.id,
          dueDate: due,
        },
      });
      await prisma.workflowEvent.createMany({
        data: [
          { caseId: wfCase.id, actor: adminEmail, action: 'case.created', toStatus: 'submitted' },
          { caseId: wfCase.id, taskId: task.id, actor: adminEmail, action: 'task.assigned', comment: 'Assigned to Sara Al-Amri' },
        ],
      });
    }
  }

  // Sprint 12: seed training catalog, role requirements, and required assignments.
  for (const c of trainingCourses) {
    const { prerequisiteCode, ...courseData } = c;
    await prisma.trainingCourse.upsert({
      where: { code: c.code },
      update: courseData as any,
      create: courseData as any,
    });
  }
  const courseByCode = new Map(
    (await prisma.trainingCourse.findMany()).map((c) => [c.code, c]),
  );
  for (const c of trainingCourses) {
    if (!c.prerequisiteCode) continue;
    const course = courseByCode.get(c.code);
    const prerequisite = courseByCode.get(c.prerequisiteCode);
    if (!course || !prerequisite) continue;
    await prisma.trainingCourse.update({
      where: { id: course.id },
      data: { prerequisiteCourseId: prerequisite.id },
    });
  }
  const roleByCode = new Map((await prisma.role.findMany()).map((r) => [r.code, r]));
  for (const r of trainingRequirements) {
    const course = courseByCode.get(r.courseCode);
    const role = roleByCode.get(r.roleCode);
    if (!course || !role) continue;
    await prisma.trainingRequirement.upsert({
      where: { courseId_roleId: { courseId: course.id, roleId: role.id } },
      update: {
        mandatory: r.mandatory,
        dueDays: r.dueDays,
        validityMonths: course.validityMonths,
      },
      create: {
        courseId: course.id,
        roleId: role.id,
        mandatory: r.mandatory,
        dueDays: r.dueDays,
        validityMonths: course.validityMonths,
      },
    });
  }
  const activeRequirements = await prisma.trainingRequirement.findMany({
    include: { course: true, role: true },
  });
  const now = new Date();
  await prisma.trainingAssignment.updateMany({
    where: { status: 'completed', expiresAt: { lt: now } },
    data: { status: 'expired' },
  });
  for (const req of activeRequirements) {
    const holders = await prisma.userRole.findMany({
      where: { roleId: req.roleId },
      include: { user: { include: { person: true } } },
    });
    for (const holder of holders) {
      const existing = await prisma.trainingAssignment.findFirst({
        where: {
          courseId: req.courseId,
          userId: holder.userId,
          OR: [
            { status: { in: ['assigned', 'in_progress'] } },
            { status: 'completed', OR: [{ expiresAt: null }, { expiresAt: { gte: now } }] },
          ],
        },
      });
      if (existing) continue;
      const dueDate = new Date();
      dueDate.setDate(dueDate.getDate() + req.dueDays);
      await prisma.trainingAssignment.create({
        data: {
          courseId: req.courseId,
          userId: holder.userId,
          personId: holder.user.person?.id ?? null,
          dueDate,
          assignedBy: adminEmail,
          source: 'role_requirement',
        },
      });
    }
  }

  for (const track of certificationTracks) {
    await prisma.certificationTrack.upsert({
      where: { code: track.code },
      update: track as any,
      create: track as any,
    });
  }
  const trackByCode = new Map(
    (await prisma.certificationTrack.findMany()).map((track) => [track.code, track]),
  );
  for (const cert of certificationAttempts) {
    const track = trackByCode.get(cert.trackCode);
    const userId = userByEmail.get(cert.userEmail);
    if (!track || !userId) continue;
    const personId = personByEmail.get(cert.userEmail) ?? null;
    const issuedAt = cert.status === 'passed' ? new Date() : null;
    const expiresAt = issuedAt ? new Date(issuedAt) : null;
    if (expiresAt) expiresAt.setMonth(expiresAt.getMonth() + track.validityMonths);
    const renewalDueAt = expiresAt ? new Date(expiresAt) : null;
    if (renewalDueAt) renewalDueAt.setDate(renewalDueAt.getDate() - 60);
    const data = {
      trackId: track.id,
      userId,
      personId,
      status: cert.status as any,
      examScore: cert.examScore,
      caseStudyScore: cert.caseStudyScore,
      peerReviewScore: cert.peerReviewScore,
      issuedAt,
      expiresAt,
      renewalDueAt,
      evidenceNote: cert.evidenceNote,
      assessor: adminEmail,
    };
    const existing = await prisma.certificationAttempt.findFirst({
      where: { trackId: track.id, userId },
    });
    if (existing) await prisma.certificationAttempt.update({ where: { id: existing.id }, data });
    else await prisma.certificationAttempt.create({ data });
  }

  for (const activity of continuingEducationActivities) {
    const userId = userByEmail.get(activity.userEmail);
    if (!userId) continue;
    const personId = personByEmail.get(activity.userEmail) ?? null;
    const data = {
      userId,
      personId,
      titleEn: activity.titleEn,
      titleAr: activity.titleAr,
      activityType: activity.activityType,
      hours: activity.hours,
      activityDate: new Date(),
      evidenceNote: activity.evidenceNote,
      approvedBy: adminEmail,
      approvedAt: new Date(),
    };
    const existing = await prisma.continuingEducationActivity.findFirst({
      where: { userId, titleEn: activity.titleEn },
    });
    if (existing) await prisma.continuingEducationActivity.update({ where: { id: existing.id }, data });
    else await prisma.continuingEducationActivity.create({ data });
  }

  for (const article of communityArticles) {
    const authorPersonId = personByEmail.get(article.authorEmail) ?? null;
    const data = {
      titleEn: article.titleEn,
      titleAr: article.titleAr,
      summaryEn: article.summaryEn,
      summaryAr: article.summaryAr,
      category: article.category,
      authorPersonId,
      contributionPoints: article.contributionPoints,
      isFeatured: article.isFeatured,
      status: 'published',
    };
    const existing = await prisma.communityArticle.findFirst({ where: { titleEn: article.titleEn } });
    if (existing) await prisma.communityArticle.update({ where: { id: existing.id }, data });
    else await prisma.communityArticle.create({ data });
  }

  for (const expert of expertProfiles) {
    const personId = personByEmail.get(expert.personEmail);
    if (!personId) continue;
    await prisma.expertProfile.upsert({
      where: { personId },
      update: {
        expertiseArea: expert.expertiseArea,
        bio: expert.bio,
        contributionPoints: expert.contributionPoints,
        mentorshipCapacity: expert.mentorshipCapacity,
        isMentor: expert.isMentor,
        isActive: true,
      },
      create: {
        personId,
        expertiseArea: expert.expertiseArea,
        bio: expert.bio,
        contributionPoints: expert.contributionPoints,
        mentorshipCapacity: expert.mentorshipCapacity,
        isMentor: expert.isMentor,
        isActive: true,
      },
    });
  }

  for (const mentorship of mentorshipPairs) {
    const mentorPersonId = personByEmail.get(mentorship.mentorEmail);
    const menteePersonId = personByEmail.get(mentorship.menteeEmail);
    if (!mentorPersonId || !menteePersonId) continue;
    const data = {
      mentorPersonId,
      menteePersonId,
      status: mentorship.status as any,
      focusArea: mentorship.focusArea,
      startDate: new Date(),
      targetEndDate: null,
      progressNote: mentorship.progressNote,
    };
    const existing = await prisma.mentorshipPair.findFirst({
      where: { mentorPersonId, menteePersonId, focusArea: mentorship.focusArea },
    });
    if (existing) await prisma.mentorshipPair.update({ where: { id: existing.id }, data });
    else await prisma.mentorshipPair.create({ data });
  }

  // Sprint 13: seed data quality issues and link each to a workflow case.
  const dqRoleTypeId = roleTypeByCode.get('dq_steward');
  for (const sample of sampleDataQualityIssues) {
    const asset = await prisma.dataAsset.findUnique({
      where: { code: sample.assetCode },
      include: { subjects: true },
    });
    if (!asset) continue;
    const dqRuleScopes = [
      ...(asset.domainId ? [{ scopeType: 'domain' as const, refId: asset.domainId }] : []),
      ...(asset.capabilityId ? [{ scopeType: 'capability' as const, refId: asset.capabilityId }] : []),
      ...asset.subjects.map((s) => ({ scopeType: 'subject' as const, refId: s.dataSubjectId })),
    ];
    const responsible = dqRoleTypeId && dqRuleScopes.length
      ? await prisma.assignmentRule.findFirst({
          where: {
            roleTypeId: dqRoleTypeId,
            deletedAt: null,
            isActive: true,
            OR: dqRuleScopes,
          },
          include: { person: true },
          orderBy: { priority: 'asc' },
        })
      : null;
    const dueDate = new Date();
    dueDate.setDate(dueDate.getDate() + 7);
    let issue = await prisma.dataQualityIssue.findUnique({ where: { code: sample.code } });
    const detectedAt = issue?.detectedAt ?? new Date();
    const priority = seedPriority(sample.severity);
    const issueData = {
      title: sample.title,
      description: sample.description,
      severity: sample.severity as any,
      dimension: sample.dimension as any,
      priority: priority as any,
      source: 'seed',
      assetId: asset.id,
      responsiblePersonId: responsible?.personId ?? null,
      dueDate,
      ...seedSlaDates(detectedAt, priority),
      createdBy: adminEmail,
    };
    if (issue) {
      issue = await prisma.dataQualityIssue.update({
        where: { id: issue.id },
        data: issueData,
      });
    } else {
      issue = await prisma.dataQualityIssue.create({
        data: { code: sample.code, ...issueData },
      });
      await prisma.dataQualityIssueEvidence.create({
        data: {
          issueId: issue.id,
          action: 'issue.created',
          actor: adminEmail,
          note: 'Seeded sample issue for Sprint 13 demonstration.',
        },
      });
    }
    if (!issue.workflowCaseId) {
      const caseCode = `WFC-${sample.code}`;
      let wfCase = await prisma.workflowCase.findUnique({ where: { code: caseCode } });
      if (!wfCase) {
        wfCase = await prisma.workflowCase.create({
          data: {
            code: caseCode,
            title: `Resolve DQ issue: ${sample.title}`,
            description: sample.description,
            type: 'data_quality_issue',
            status: 'submitted',
            assetId: asset.id,
            createdBy: adminEmail,
          },
        });
        const task = await prisma.workflowTask.create({
          data: {
            caseId: wfCase.id,
            title: 'Investigate and remediate data quality issue',
            type: 'remediation',
            status: 'pending',
            assigneeUserId: responsible?.person.userId ?? null,
            dueDate,
          },
        });
        await prisma.workflowEvent.createMany({
          data: [
            { caseId: wfCase.id, actor: adminEmail, action: 'case.created', toStatus: 'submitted' },
            { caseId: wfCase.id, taskId: task.id, actor: adminEmail, action: 'task.assigned', comment: responsible?.person.fullNameEn ?? 'Unassigned' },
          ],
        });
      }
      await prisma.dataQualityIssue.update({
        where: { id: issue.id },
        data: { workflowCaseId: wfCase.id, status: 'triaged' },
      });
    }
  }

  // Sprint 13 v4: rule lifecycle, scorecards, and profiling import summaries.
  await prisma.dataQualityScore.deleteMany({ where: { source: { in: ['seed_rule', 'seed_profile'] } } });
  for (const sample of sampleDataQualityRules) {
    const assetId = assetByCode.get(sample.assetCode);
    const domainId = domainByCode.get(sample.domainCode);
    const ownerPersonId = personByEmail.get(sample.ownerEmail) ?? null;
    if (!assetId || !domainId) continue;
    const now = new Date();
    const ruleData = {
      nameEn: sample.nameEn,
      nameAr: sample.nameAr,
      description: sample.description,
      dimension: sample.dimension as any,
      status: sample.status as any,
      assetId,
      domainId,
      ownerPersonId,
      severity: sample.severity as any,
      thresholdExpression: sample.thresholdExpression,
      checkFrequency: sample.checkFrequency,
      impactSummary: sample.impactSummary,
      currentVersion: 1,
      approvedBy: ['approved', 'deployed'].includes(sample.status) ? adminEmail : null,
      approvedAt: ['approved', 'deployed'].includes(sample.status) ? now : null,
      deployedAt: sample.status === 'deployed' ? now : null,
      retiredAt: null,
      createdBy: adminEmail,
    };
    const rule = await prisma.dataQualityRule.upsert({
      where: { code: sample.code },
      update: ruleData,
      create: { code: sample.code, ...ruleData },
    });
    await prisma.dataQualityRuleVersion.upsert({
      where: { ruleId_version: { ruleId: rule.id, version: 1 } },
      update: {
        status: sample.status as any,
        definitionJson: {
          threshold: sample.thresholdExpression,
          frequency: sample.checkFrequency,
          impact: sample.impactSummary,
        },
        changeSummary: 'Seeded v4 rule lifecycle definition.',
        reviewedBy: ['approved', 'deployed'].includes(sample.status) ? adminEmail : null,
        reviewedAt: ['approved', 'deployed'].includes(sample.status) ? now : null,
      },
      create: {
        ruleId: rule.id,
        version: 1,
        status: sample.status as any,
        definitionJson: {
          threshold: sample.thresholdExpression,
          frequency: sample.checkFrequency,
          impact: sample.impactSummary,
        },
        changeSummary: 'Seeded v4 rule lifecycle definition.',
        createdBy: adminEmail,
        reviewedBy: ['approved', 'deployed'].includes(sample.status) ? adminEmail : null,
        reviewedAt: ['approved', 'deployed'].includes(sample.status) ? now : null,
      },
    });
    await prisma.dataQualityScore.create({
      data: {
        level: 'rule' as any,
        refId: rule.id,
        dimension: sample.dimension as any,
        score: sample.score,
        totalChecks: 1,
        failedChecks: sample.score < 80 ? 1 : 0,
        source: 'seed_rule',
        assetId,
        domainId,
        ruleId: rule.id,
        notes: 'Seeded rule score for Sprint 13 scorecard.',
      },
    });
  }

  await prisma.dataQualityProfile.deleteMany({ where: { source: 'seed_profile' } });
  for (const profileSeed of sampleDataQualityProfiles) {
    const assetId = assetByCode.get(profileSeed.assetCode);
    const domainId = domainByCode.get(profileSeed.domainCode);
    if (!assetId || !domainId) continue;
    const score = seedProfileScore(profileSeed.columns);
    const profile = await prisma.dataQualityProfile.create({
      data: {
        assetId,
        domainId,
        source: profileSeed.source,
        importedBy: adminEmail,
        rowCount: profileSeed.rowCount,
        columnCount: profileSeed.columns.length,
        qualityScore: score.qualityScore,
        recommendedRules: score.recommendedRules,
        anomalyCount: score.anomalyCount,
        summaryJson: {
          source: 'Seeded profiling import',
          recommendation: 'Review suggested rules before deployment.',
        },
        columns: {
          create: profileSeed.columns.map((column) => ({
            columnName: column.columnName,
            dataType: column.dataType,
            completenessPct: column.completenessPct,
            uniquenessPct: column.uniquenessPct,
            validityPct: column.validityPct,
            pattern: column.pattern,
            anomalyCount: column.anomalyCount,
            recommendation: column.recommendation,
            dimension: column.dimension as any,
          })),
        },
      },
    });
    await prisma.dataQualityScore.create({
      data: {
        level: 'asset' as any,
        refId: assetId,
        dimension: null,
        score: score.qualityScore,
        totalChecks: profileSeed.columns.length,
        failedChecks: score.recommendedRules,
        source: 'seed_profile',
        assetId,
        domainId,
        notes: `Profiling score generated from ${profile.columnCount} columns.`,
      },
    });
  }

  // Sprint 17 v4: Open Data candidate registry with eligibility signals.
  const openDataSignalForRank = (rank?: number | null) => {
    if (rank == null) return 'needs_review';
    if (rank <= 1) return 'ready';
    if (rank === 2) return 'needs_review';
    return 'blocked';
  };
  const openDataSignalForScore = (score?: number | null) => {
    if (score == null) return 'needs_review';
    if (score >= 85) return 'ready';
    if (score >= 70) return 'needs_review';
    return 'blocked';
  };
  const openDataSignalForPersonalData = (assessment: string) => {
    if (['none', 'aggregated'].includes(assessment)) return 'ready';
    if (assessment === 'unknown') return 'needs_review';
    return 'blocked';
  };
  const openDataSignalForOwnership = (ownerPersonId?: string | null, stewardPersonId?: string | null) => {
    if (ownerPersonId && stewardPersonId) return 'ready';
    if (ownerPersonId || stewardPersonId) return 'needs_review';
    return 'blocked';
  };
  const openDataSignalForValue = (score: number) => {
    if (score >= 70) return 'ready';
    if (score >= 40) return 'needs_review';
    return 'blocked';
  };
  const openDataSignalPoints = (signal: string) => signal === 'ready' ? 100 : signal === 'needs_review' ? 60 : 0;
  for (const candidateSeed of sampleOpenDataCandidates) {
    const assetId = assetByCode.get(candidateSeed.assetCode);
    if (!assetId) continue;
    const asset = await prisma.dataAsset.findUnique({
      where: { id: assetId },
      include: { classification: true },
    });
    if (!asset) continue;
    const dqScore = await prisma.dataQualityScore.findFirst({
      where: { assetId },
      orderBy: { measuredAt: 'desc' },
      select: { id: true, score: true },
    });
    const ownerPersonId = personByEmail.get(candidateSeed.ownerEmail) ?? null;
    const stewardPersonId = personByEmail.get(candidateSeed.stewardEmail) ?? null;
    const odiaoReviewerPersonId = personByEmail.get(candidateSeed.reviewerEmail) ?? null;
    const signals: any = {
      classificationSignal: openDataSignalForRank(asset.classification?.rank),
      dataQualitySignal: openDataSignalForScore(dqScore?.score),
      personalDataSignal: openDataSignalForPersonalData(candidateSeed.personalDataAssessment),
      ownershipSignal: openDataSignalForOwnership(ownerPersonId, stewardPersonId),
      publicationValueSignal: openDataSignalForValue(candidateSeed.publicationValueScore),
    };
    const blockers = Object.entries(signals).filter(([, value]) => value === 'blocked').map(([key]) => key);
    const reviewItems = Object.entries(signals).filter(([, value]) => value === 'needs_review').map(([key]) => key);
    const signalValues = Object.values(signals) as string[];
    const eligibilityScore = Math.round(signalValues.reduce((sum, signal) => sum + openDataSignalPoints(signal), 0) / signalValues.length);
    const nextReviewAt = new Date();
    nextReviewAt.setDate(nextReviewAt.getDate() + 60);
    await prisma.openDataCandidate.upsert({
      where: { code: candidateSeed.code },
      update: {
        assetId,
        titleEn: candidateSeed.titleEn,
        titleAr: candidateSeed.titleAr,
        description: candidateSeed.description,
        status: candidateSeed.status as any,
        publicationFrequency: candidateSeed.publicationFrequency as any,
        publicationFormat: candidateSeed.publicationFormat as any,
        ownerPersonId,
        stewardPersonId,
        odiaoReviewerPersonId,
        classificationId: asset.classificationId,
        dqScoreId: dqScore?.id ?? null,
        personalDataAssessment: candidateSeed.personalDataAssessment as any,
        ...signals,
        publicationValueScore: candidateSeed.publicationValueScore,
        eligibilityScore,
        eligibilityJson: {
          overallSignal: blockers.length ? 'blocked' : reviewItems.length ? 'needs_review' : 'ready',
          blockers,
          reviewItems,
          qualityScore: dqScore?.score ?? null,
          classificationRank: asset.classification?.rank ?? null,
        },
        decisionNote: candidateSeed.decisionNote,
        nextReviewAt,
        deletedAt: null,
        updatedBy: adminEmail,
      },
      create: {
        code: candidateSeed.code,
        assetId,
        titleEn: candidateSeed.titleEn,
        titleAr: candidateSeed.titleAr,
        description: candidateSeed.description,
        status: candidateSeed.status as any,
        publicationFrequency: candidateSeed.publicationFrequency as any,
        publicationFormat: candidateSeed.publicationFormat as any,
        ownerPersonId,
        stewardPersonId,
        odiaoReviewerPersonId,
        classificationId: asset.classificationId,
        dqScoreId: dqScore?.id ?? null,
        personalDataAssessment: candidateSeed.personalDataAssessment as any,
        ...signals,
        publicationValueScore: candidateSeed.publicationValueScore,
        eligibilityScore,
        eligibilityJson: {
          overallSignal: blockers.length ? 'blocked' : reviewItems.length ? 'needs_review' : 'ready',
          blockers,
          reviewItems,
          qualityScore: dqScore?.score ?? null,
          classificationRank: asset.classification?.rank ?? null,
        },
        decisionNote: candidateSeed.decisionNote,
        nextReviewAt,
        createdBy: adminEmail,
      },
    });
  }

  const foiSeedDueDate = (start: Date, days: number) => {
    const due = new Date(start);
    let remaining = days;
    while (remaining > 0) {
      due.setDate(due.getDate() + 1);
      if (![5, 6].includes(due.getDay())) remaining -= 1;
    }
    return due;
  };

  for (const templateSeed of sampleFoiResponseTemplates) {
    await prisma.foiResponseTemplate.upsert({
      where: { code: templateSeed.code },
      update: {
        nameEn: templateSeed.nameEn,
        nameAr: templateSeed.nameAr,
        outcome: templateSeed.outcome as any,
        bodyEn: templateSeed.bodyEn,
        bodyAr: templateSeed.bodyAr,
        isActive: true,
      },
      create: {
        code: templateSeed.code,
        nameEn: templateSeed.nameEn,
        nameAr: templateSeed.nameAr,
        outcome: templateSeed.outcome as any,
        bodyEn: templateSeed.bodyEn,
        bodyAr: templateSeed.bodyAr,
      },
    });
  }

  for (const requestSeed of sampleFoiRequests) {
    const assetId = assetByCode.get(requestSeed.assetCode) ?? null;
    const dataDomainId = domainByCode.get(requestSeed.domainCode) ?? null;
    const classificationId = classificationByCode.get(requestSeed.classificationCode) ?? null;
    const assignedOfficerPersonId = personByEmail.get(requestSeed.assignedEmail) ?? null;
    const receivedAt = new Date();
    receivedAt.setDate(receivedAt.getDate() - 4);
    const dueAt = foiSeedDueDate(receivedAt, 20);
    const foiRequest = await prisma.foiRequest.upsert({
      where: { requestNumber: requestSeed.requestNumber },
      update: {
        requesterName: requestSeed.requesterName,
        requesterEmail: requestSeed.requesterEmail,
        requesterType: requestSeed.requesterType as any,
        channel: requestSeed.channel as any,
        category: requestSeed.category as any,
        subject: requestSeed.subject,
        description: requestSeed.description,
        status: requestSeed.status as any,
        identityValidated: requestSeed.identityValidated,
        contactValidated: requestSeed.contactValidated,
        assetId,
        dataDomainId,
        classificationId,
        assignedOfficerPersonId,
        receivedAt,
        dueAt,
        updatedBy: adminEmail,
        deletedAt: null,
      },
      create: {
        requestNumber: requestSeed.requestNumber,
        requesterName: requestSeed.requesterName,
        requesterEmail: requestSeed.requesterEmail,
        requesterType: requestSeed.requesterType as any,
        channel: requestSeed.channel as any,
        category: requestSeed.category as any,
        subject: requestSeed.subject,
        description: requestSeed.description,
        status: requestSeed.status as any,
        identityValidated: requestSeed.identityValidated,
        contactValidated: requestSeed.contactValidated,
        assetId,
        dataDomainId,
        classificationId,
        assignedOfficerPersonId,
        receivedAt,
        dueAt,
        createdBy: adminEmail,
      },
    });
    for (const reviewType of ['classification', 'privacy', 'legal']) {
      await prisma.foiReview.upsert({
        where: { requestId_reviewType: { requestId: foiRequest.id, reviewType: reviewType as any } },
        update: {
          status: reviewType === 'classification' ? 'completed' as any : 'pending' as any,
          reviewerPersonId: assignedOfficerPersonId,
          note: reviewType === 'classification' ? 'Seeded classification triage completed.' : null,
          completedAt: reviewType === 'classification' ? new Date() : null,
        },
        create: {
          requestId: foiRequest.id,
          reviewType: reviewType as any,
          status: reviewType === 'classification' ? 'completed' as any : 'pending' as any,
          reviewerPersonId: assignedOfficerPersonId,
          note: reviewType === 'classification' ? 'Seeded classification triage completed.' : null,
          completedAt: reviewType === 'classification' ? new Date() : null,
          createdBy: adminEmail,
        },
      });
    }
    const caseCode = `WFC-${requestSeed.requestNumber}`;
    const wfCase = await prisma.workflowCase.upsert({
      where: { code: caseCode },
      update: {
        title: `FOI request ${requestSeed.requestNumber}`,
        description: requestSeed.subject,
        type: 'foi_request',
        status: 'submitted' as any,
        assetId,
      },
      create: {
        code: caseCode,
        title: `FOI request ${requestSeed.requestNumber}`,
        description: requestSeed.subject,
        type: 'foi_request',
        status: 'submitted' as any,
        assetId,
        createdBy: adminEmail,
      },
    });
    if (foiRequest.workflowCaseId !== wfCase.id) {
      await prisma.foiRequest.update({ where: { id: foiRequest.id }, data: { workflowCaseId: wfCase.id } });
    }
    const taskExists = await prisma.workflowTask.findFirst({
      where: { caseId: wfCase.id, title: 'Validate FOI intake and prepare review' },
      select: { id: true },
    });
    if (!taskExists) {
      await prisma.workflowTask.create({
        data: {
          caseId: wfCase.id,
          title: 'Validate FOI intake and prepare review',
          type: 'information',
          status: 'pending' as any,
          dueDate: foiSeedDueDate(new Date(), 1),
        },
      });
    }
  }

  // Sprint 14 v4: classification, masking, role-data access, access review, DLP, and ABAC evidence.
  for (const policySeed of sampleMaskingPolicies) {
    const domainId = domainByCode.get(policySeed.domainCode) ?? null;
    const classificationId = classificationByCode.get(policySeed.classificationCode) ?? null;
    await prisma.maskingPolicy.upsert({
      where: { code: policySeed.code },
      update: {
        nameEn: policySeed.nameEn,
        nameAr: policySeed.nameAr,
        technique: policySeed.technique as any,
        description: policySeed.description,
        domainId,
        classificationId,
        appliesToPersonalData: true,
        fieldsJson: policySeed.fieldsJson as any,
        previewBefore: policySeed.previewBefore,
        previewAfter: policySeed.previewAfter,
        isActive: true,
        deletedAt: null,
      },
      create: {
        code: policySeed.code,
        nameEn: policySeed.nameEn,
        nameAr: policySeed.nameAr,
        technique: policySeed.technique as any,
        description: policySeed.description,
        domainId,
        classificationId,
        appliesToPersonalData: true,
        fieldsJson: policySeed.fieldsJson as any,
        previewBefore: policySeed.previewBefore,
        previewAfter: policySeed.previewAfter,
        createdBy: adminEmail,
      },
    });
  }
  const maskingByCode = new Map((await prisma.maskingPolicy.findMany()).map((policy) => [policy.code, policy.id]));
  for (const accessSeed of sampleRoleDataAccessMaps) {
    const role = roleByCode.get(accessSeed.roleCode);
    const domainId = domainByCode.get(accessSeed.domainCode) ?? null;
    const classificationId = classificationByCode.get(accessSeed.classificationCode) ?? null;
    const maskingPolicyId = accessSeed.maskingCode ? (maskingByCode.get(accessSeed.maskingCode) ?? null) : null;
    if (!role) continue;
    const nextReviewAt = new Date();
    nextReviewAt.setDate(nextReviewAt.getDate() + 90);
    const data = {
      roleId: role.id,
      domainId,
      classificationId,
      maskingPolicyId,
      scopeKey: accessScopeKey(domainId, classificationId),
      personalDataAllowed: accessSeed.personalDataAllowed,
      approvalRequired: accessSeed.approvalRequired,
      businessJustification: accessSeed.businessJustification,
      reviewCadenceDays: 90,
      nextReviewAt,
      isActive: true,
      createdBy: adminEmail,
    };
    const existing = await prisma.roleDataAccessMap.findFirst({
      where: { roleId: role.id, scopeKey: data.scopeKey, isActive: true },
    });
    if (existing) await prisma.roleDataAccessMap.update({ where: { id: existing.id }, data });
    else await prisma.roleDataAccessMap.create({ data });
  }

  const accessOwnerUserId = userByEmail.get(sampleAccessReview.ownerEmail) ?? null;
  const accessDueDate = new Date();
  accessDueDate.setDate(accessDueDate.getDate() + 14);
  const accessReview = await prisma.accessReview.upsert({
    where: { code: sampleAccessReview.code },
    update: {
      title: sampleAccessReview.title,
      description: sampleAccessReview.description,
      status: 'active' as any,
      ownerUserId: accessOwnerUserId,
      dueDate: accessDueDate,
      completedAt: null,
    },
    create: {
      code: sampleAccessReview.code,
      title: sampleAccessReview.title,
      description: sampleAccessReview.description,
      status: 'active' as any,
      ownerUserId: accessOwnerUserId,
      dueDate: accessDueDate,
      createdBy: adminEmail,
    },
  });
  await prisma.accessReviewItem.deleteMany({ where: { reviewId: accessReview.id } });
  for (const item of sampleAccessReview.items) {
    const userId = userByEmail.get(item.userEmail);
    const role = roleByCode.get(item.roleCode);
    if (!userId || !role) continue;
    await prisma.accessReviewItem.create({
      data: {
        reviewId: accessReview.id,
        userId,
        roleId: role.id,
        assetId: assetByCode.get(item.assetCode) ?? null,
        domainId: domainByCode.get(item.domainCode) ?? null,
        classificationId: classificationByCode.get(item.classificationCode) ?? null,
        decision: item.decision as any,
        justification: item.justification,
        reviewer: item.decision === 'pending' ? null : adminEmail,
        reviewedAt: item.decision === 'pending' ? null : new Date(),
      },
    });
  }

  for (const incidentSeed of sampleDlpIncidents) {
    const assetId = assetByCode.get(incidentSeed.assetCode) ?? null;
    const classificationId = classificationByCode.get(incidentSeed.classificationCode) ?? null;
    const assignedPersonId = personByEmail.get(incidentSeed.assignedEmail) ?? null;
    await prisma.dlpIncident.upsert({
      where: { code: incidentSeed.code },
      update: {
        title: incidentSeed.title,
        description: incidentSeed.description,
        severity: incidentSeed.severity as any,
        status: incidentSeed.status as any,
        assetId,
        classificationId,
        assignedPersonId,
        detectionSource: incidentSeed.detectionSource,
      },
      create: {
        code: incidentSeed.code,
        title: incidentSeed.title,
        description: incidentSeed.description,
        severity: incidentSeed.severity as any,
        status: incidentSeed.status as any,
        assetId,
        classificationId,
        assignedPersonId,
        detectionSource: incidentSeed.detectionSource,
        createdBy: adminEmail,
      },
    });
  }

  for (const requestSeed of sampleClassificationRequests) {
    const assetId = assetByCode.get(requestSeed.assetCode);
    const toClassificationId = classificationByCode.get(requestSeed.toClassificationCode);
    if (!assetId || !toClassificationId) continue;
    const asset = await prisma.dataAsset.findUnique({ where: { id: assetId } });
    const existing = await prisma.classificationChangeRequest.findFirst({
      where: {
        assetId,
        toClassificationId,
        status: { in: ['pending', 'approved'] as any },
      },
    });
    const data = {
      assetId,
      fromClassificationId: asset?.classificationId ?? null,
      toClassificationId,
      reason: requestSeed.reason,
      requestedBy: requestSeed.requestedBy,
      status: 'pending' as any,
    };
    if (existing) await prisma.classificationChangeRequest.update({ where: { id: existing.id }, data });
    else await prisma.classificationChangeRequest.create({ data });
  }

  // Sprint 22 v4: PDP privacy operations foundation.
  for (const basisSeed of samplePrivacyLegalBases) {
    await prisma.privacyLegalBasis.upsert({
      where: { code: basisSeed.code },
      update: {
        nameEn: basisSeed.nameEn,
        nameAr: basisSeed.nameAr,
        category: basisSeed.category as any,
        authority: basisSeed.authority,
        description: basisSeed.description,
        isActive: true,
      },
      create: {
        code: basisSeed.code,
        nameEn: basisSeed.nameEn,
        nameAr: basisSeed.nameAr,
        category: basisSeed.category as any,
        authority: basisSeed.authority,
        description: basisSeed.description,
      },
    });
  }
  const legalBasisByCode = new Map((await prisma.privacyLegalBasis.findMany()).map((basis) => [basis.code, basis.id]));

  for (const ropaSeed of samplePrivacyRopaRecords) {
    const assetId = assetByCode.get(ropaSeed.assetCode) ?? null;
    const domainId = domainByCode.get(ropaSeed.domainCode) ?? null;
    const ownerPersonId = personByEmail.get(ropaSeed.ownerEmail) ?? null;
    const legalBasisId = legalBasisByCode.get(ropaSeed.legalBasisCode) ?? null;
    const code = `ROPA-${ropaSeed.assetCode}`;
    const reviewDueAt = new Date();
    reviewDueAt.setDate(reviewDueAt.getDate() + 45);
    await prisma.privacyRopaRecord.upsert({
      where: { code },
      update: {
        processName: ropaSeed.processName,
        purpose: ropaSeed.purpose,
        assetId,
        domainId,
        legalBasisId,
        ownerPersonId,
        dataSubjects: ropaSeed.dataSubjects,
        recipients: ropaSeed.recipients,
        retentionSummary: ropaSeed.retentionSummary,
        status: ropaSeed.status as any,
        reviewDueAt,
        updatedBy: adminEmail,
        deletedAt: null,
      },
      create: {
        code,
        processName: ropaSeed.processName,
        purpose: ropaSeed.purpose,
        assetId,
        domainId,
        legalBasisId,
        ownerPersonId,
        dataSubjects: ropaSeed.dataSubjects,
        recipients: ropaSeed.recipients,
        retentionSummary: ropaSeed.retentionSummary,
        status: ropaSeed.status as any,
        reviewDueAt,
        createdBy: adminEmail,
      },
    });
  }

  for (const dpiaSeed of samplePrivacyDpias) {
    const assetId = assetByCode.get(dpiaSeed.assetCode) ?? null;
    const asset = assetId ? await prisma.dataAsset.findUnique({ where: { id: assetId }, include: { classification: true, subjects: true } }) : null;
    const domainId = domainByCode.get(dpiaSeed.domainCode) ?? asset?.domainId ?? null;
    const legalBasisId = legalBasisByCode.get(dpiaSeed.legalBasisCode) ?? null;
    const reviewerPersonId = personByEmail.get(dpiaSeed.reviewerEmail) ?? null;
    const code = `DPIA-${dpiaSeed.assetCode}`;
    const dueAt = foiSeedDueDate(new Date(), 10);
    const inherentRiskScore = Math.min(100, (asset?.classification?.rank ?? 2) * 18 + (dpiaSeed.crossBorderTransfer ? 32 : 20));
    const residualRiskScore = Math.max(0, inherentRiskScore - 20);
    const dpia = await prisma.privacyDpia.upsert({
      where: { code },
      update: {
        title: dpiaSeed.title,
        description: dpiaSeed.description,
        assetId,
        domainId,
        legalBasisId,
        classificationId: asset?.classificationId ?? null,
        status: 'under_review' as any,
        riskLevel: residualRiskScore >= 80 ? 'critical' as any : residualRiskScore >= 60 ? 'high' as any : 'medium' as any,
        inherentRiskScore,
        residualRiskScore,
        crossBorderTransfer: dpiaSeed.crossBorderTransfer,
        reviewerPersonId,
        dueAt,
        updatedBy: adminEmail,
        deletedAt: null,
      },
      create: {
        code,
        title: dpiaSeed.title,
        description: dpiaSeed.description,
        assetId,
        domainId,
        legalBasisId,
        classificationId: asset?.classificationId ?? null,
        status: 'under_review' as any,
        riskLevel: residualRiskScore >= 80 ? 'critical' as any : residualRiskScore >= 60 ? 'high' as any : 'medium' as any,
        inherentRiskScore,
        residualRiskScore,
        crossBorderTransfer: dpiaSeed.crossBorderTransfer,
        reviewerPersonId,
        dueAt,
        createdBy: adminEmail,
      },
    });
    for (const [phase, status] of Object.entries(dpiaSeed.gateStatuses)) {
      await prisma.privacyGate.upsert({
        where: { dpiaId_phase: { dpiaId: dpia.id, phase: phase as any } },
        update: {
          status: status as any,
          reviewerPersonId,
          note: status === 'approved' ? 'Seeded gate approved for demo continuity.' : null,
          completedAt: status === 'approved' ? new Date() : null,
        },
        create: {
          dpiaId: dpia.id,
          phase: phase as any,
          status: status as any,
          reviewerPersonId,
          note: status === 'approved' ? 'Seeded gate approved for demo continuity.' : null,
          completedAt: status === 'approved' ? new Date() : null,
          dueAt: foiSeedDueDate(new Date(), 5),
          createdBy: adminEmail,
        },
      });
    }
    const wfCase = await prisma.workflowCase.upsert({
      where: { code: `WFC-${code}` },
      update: { title: `DPIA ${code}`, description: dpiaSeed.title, type: 'privacy_dpia', status: 'submitted' as any, assetId },
      create: { code: `WFC-${code}`, title: `DPIA ${code}`, description: dpiaSeed.title, type: 'privacy_dpia', status: 'submitted' as any, assetId, createdBy: adminEmail },
    });
    await prisma.privacyDpia.update({ where: { id: dpia.id }, data: { workflowCaseId: wfCase.id } });
    const taskExists = await prisma.workflowTask.findFirst({ where: { caseId: wfCase.id, title: 'Review DPIA privacy gates' }, select: { id: true } });
    if (!taskExists) {
      const reviewerUserId = dpiaSeed.reviewerEmail ? userByEmail.get(dpiaSeed.reviewerEmail) ?? null : null;
      await prisma.workflowTask.create({ data: { caseId: wfCase.id, title: 'Review DPIA privacy gates', type: 'review', status: 'pending' as any, assigneeUserId: reviewerUserId, dueDate: dueAt } });
    }
  }

  for (const dsrSeed of samplePrivacyDsrRequests) {
    const year = new Date().getFullYear();
    const requestNumber = `DSR-${year}-0001`;
    const assetId = assetByCode.get(dsrSeed.assetCode) ?? null;
    const domainId = domainByCode.get(dsrSeed.domainCode) ?? null;
    const assignedPersonId = personByEmail.get(dsrSeed.assignedEmail) ?? null;
    const dueAt = foiSeedDueDate(new Date(), 20);
    const dsr = await prisma.privacyDsrRequest.upsert({
      where: { requestNumber },
      update: {
        requesterName: dsrSeed.requesterName,
        requesterEmail: dsrSeed.requesterEmail,
        requestType: dsrSeed.requestType as any,
        description: dsrSeed.description,
        identityValidated: dsrSeed.identityValidated,
        status: dsrSeed.status as any,
        assetId,
        domainId,
        assignedPersonId,
        dueAt,
        updatedBy: adminEmail,
        deletedAt: null,
      },
      create: {
        requestNumber,
        requesterName: dsrSeed.requesterName,
        requesterEmail: dsrSeed.requesterEmail,
        requestType: dsrSeed.requestType as any,
        description: dsrSeed.description,
        identityValidated: dsrSeed.identityValidated,
        status: dsrSeed.status as any,
        assetId,
        domainId,
        assignedPersonId,
        dueAt,
        createdBy: adminEmail,
      },
    });
    const wfCase = await prisma.workflowCase.upsert({
      where: { code: `WFC-${requestNumber}` },
      update: { title: `DSR ${requestNumber}`, description: dsr.description, type: 'privacy_dsr', status: 'submitted' as any, assetId },
      create: { code: `WFC-${requestNumber}`, title: `DSR ${requestNumber}`, description: dsr.description, type: 'privacy_dsr', status: 'submitted' as any, assetId, createdBy: adminEmail },
    });
    await prisma.privacyDsrRequest.update({ where: { id: dsr.id }, data: { workflowCaseId: wfCase.id } });
  }

  for (const breachSeed of samplePrivacyBreaches) {
    const year = new Date().getFullYear();
    const code = `BRCH-${year}-0001`;
    const assetId = assetByCode.get(breachSeed.assetCode) ?? null;
    const domainId = domainByCode.get(breachSeed.domainCode) ?? null;
    const assignedPersonId = personByEmail.get(breachSeed.assignedEmail) ?? null;
    const detectedAt = new Date();
    detectedAt.setHours(detectedAt.getHours() - 18);
    const notificationDueAt = new Date(detectedAt);
    notificationDueAt.setHours(notificationDueAt.getHours() + 72);
    const breach = await prisma.privacyBreach.upsert({
      where: { code },
      update: {
        title: breachSeed.title,
        description: breachSeed.description,
        assetId,
        domainId,
        severity: breachSeed.severity as any,
        status: breachSeed.status as any,
        detectedAt,
        notificationDueAt,
        assignedPersonId,
        updatedBy: adminEmail,
        deletedAt: null,
      },
      create: {
        code,
        title: breachSeed.title,
        description: breachSeed.description,
        assetId,
        domainId,
        severity: breachSeed.severity as any,
        status: breachSeed.status as any,
        detectedAt,
        notificationDueAt,
        assignedPersonId,
        createdBy: adminEmail,
      },
    });
    const wfCase = await prisma.workflowCase.upsert({
      where: { code: `WFC-${code}` },
      update: { title: `Breach ${code}`, description: breach.title, type: 'privacy_breach', status: 'submitted' as any, assetId },
      create: { code: `WFC-${code}`, title: `Breach ${code}`, description: breach.title, type: 'privacy_breach', status: 'submitted' as any, assetId, createdBy: adminEmail },
    });
    await prisma.privacyBreach.update({ where: { id: breach.id }, data: { workflowCaseId: wfCase.id } });
  }

  const retentionAssetId = assetByCode.get('AST-FIN-REVENUE') ?? null;
  await prisma.privacyRetentionRule.upsert({
    where: { code: 'RET-FIN-REVENUE' },
    update: {
      nameEn: 'Revenue analytics retention review',
      nameAr: 'مراجعة احتفاظ تحليلات الإيرادات',
      assetId: retentionAssetId,
      domainId: domainByCode.get('finance') ?? null,
      trigger: 'creation' as any,
      durationDays: 1825,
      action: 'review_then_archive',
      ownerPersonId: personByEmail.get('khalid.hassan@dgop.local') ?? null,
      nextReviewAt: foiSeedDueDate(new Date(), 90),
      isActive: true,
    },
    create: {
      code: 'RET-FIN-REVENUE',
      nameEn: 'Revenue analytics retention review',
      nameAr: 'مراجعة احتفاظ تحليلات الإيرادات',
      assetId: retentionAssetId,
      domainId: domainByCode.get('finance') ?? null,
      trigger: 'creation' as any,
      durationDays: 1825,
      action: 'review_then_archive',
      ownerPersonId: personByEmail.get('khalid.hassan@dgop.local') ?? null,
      nextReviewAt: foiSeedDueDate(new Date(), 90),
      createdBy: adminEmail,
    },
  });

  // Sprint 23 v4: Data Sharing and Integration governance MVP.
  for (const sharingSeed of sampleDataSharingRequests) {
    const year = new Date().getFullYear();
    const requestNumber = `DSI-${year}-0001`;
    const assetId = assetByCode.get(sharingSeed.assetCode) ?? null;
    const domainId = domainByCode.get(sharingSeed.domainCode) ?? null;
    const legalBasisId = legalBasisByCode.get(sharingSeed.legalBasisCode) ?? null;
    const classificationId = classificationByCode.get(sharingSeed.classificationCode) ?? null;
    const maskingPolicyId = maskingByCode.get(sharingSeed.maskingPolicyCode) ?? null;
    const dataOwnerRole = roleByCode.get('data_owner');
    const roleDataAccessMap = dataOwnerRole
      ? await prisma.roleDataAccessMap.findFirst({ where: { roleId: dataOwnerRole.id, domainId, classificationId, isActive: true }, select: { id: true } })
      : null;
    const riskScore = classificationId ? 74 : 58;
    const request = await prisma.dataSharingRequest.upsert({
      where: { requestNumber },
      update: {
        requesterOrg: sharingSeed.requesterOrg,
        recipientOrg: sharingSeed.recipientOrg,
        purpose: sharingSeed.purpose,
        legalBasisId,
        assetId,
        domainId,
        classificationId,
        maskingPolicyId,
        roleDataAccessMapId: roleDataAccessMap?.id ?? null,
        consentRequired: sharingSeed.consentRequired,
        crossBorderTransfer: sharingSeed.crossBorderTransfer,
        status: 'under_review' as any,
        riskScore,
        requiredControlsJson: ['owner_review', 'privacy_review', 'security_review', 'masked_or_aggregated_output'] as any,
        updatedBy: adminEmail,
        deletedAt: null,
      },
      create: {
        requestNumber,
        requesterOrg: sharingSeed.requesterOrg,
        recipientOrg: sharingSeed.recipientOrg,
        purpose: sharingSeed.purpose,
        legalBasisId,
        assetId,
        domainId,
        classificationId,
        maskingPolicyId,
        roleDataAccessMapId: roleDataAccessMap?.id ?? null,
        consentRequired: sharingSeed.consentRequired,
        crossBorderTransfer: sharingSeed.crossBorderTransfer,
        status: 'under_review' as any,
        riskScore,
        requiredControlsJson: ['owner_review', 'privacy_review', 'security_review', 'masked_or_aggregated_output'] as any,
        createdBy: adminEmail,
      },
    });
    for (const [step, decision] of Object.entries(sharingSeed.reviews)) {
      await prisma.dataSharingReview.upsert({
        where: { requestId_step: { requestId: request.id, step: step as any } },
        update: {
          decision: decision as any,
          reviewerPersonId: step === 'owner' ? personByEmail.get('khalid.hassan@dgop.local') ?? null : personByEmail.get('sara.alamri@dgop.local') ?? null,
          note: decision === 'approved' ? 'Seeded approval for demo path.' : null,
          decidedAt: decision === 'approved' ? new Date() : null,
        },
        create: {
          requestId: request.id,
          step: step as any,
          decision: decision as any,
          reviewerPersonId: step === 'owner' ? personByEmail.get('khalid.hassan@dgop.local') ?? null : personByEmail.get('sara.alamri@dgop.local') ?? null,
          note: decision === 'approved' ? 'Seeded approval for demo path.' : null,
          decidedAt: decision === 'approved' ? new Date() : null,
          createdBy: adminEmail,
        },
      });
    }
    const wfCase = await prisma.workflowCase.upsert({
      where: { code: `WFC-${requestNumber}` },
      update: { title: `Data sharing ${requestNumber}`, description: sharingSeed.purpose, type: 'data_sharing_request', status: 'submitted' as any, assetId },
      create: { code: `WFC-${requestNumber}`, title: `Data sharing ${requestNumber}`, description: sharingSeed.purpose, type: 'data_sharing_request', status: 'submitted' as any, assetId, createdBy: adminEmail },
    });
    await prisma.dataSharingRequest.update({ where: { id: request.id }, data: { workflowCaseId: wfCase.id } });
    const agreementNumber = `DSA-${year}-0001`;
    const startAt = new Date();
    const endAt = new Date(startAt);
    endAt.setFullYear(endAt.getFullYear() + 1);
    const renewalDueAt = new Date(startAt);
    renewalDueAt.setMonth(renewalDueAt.getMonth() + 11);
    const agreement = await prisma.dataSharingAgreement.upsert({
      where: { agreementNumber },
      update: {
        requestId: request.id,
        assetId,
        domainId,
        recipientOrg: sharingSeed.recipientOrg,
        purpose: sharingSeed.purpose,
        status: 'active' as any,
        ownerPersonId: personByEmail.get('khalid.hassan@dgop.local') ?? null,
        agreementUrl: 'https://dgop.local/agreements/dsa-0001',
        startAt,
        endAt,
        renewalDueAt,
        updatedBy: adminEmail,
      },
      create: {
        agreementNumber,
        requestId: request.id,
        assetId,
        domainId,
        recipientOrg: sharingSeed.recipientOrg,
        purpose: sharingSeed.purpose,
        status: 'active' as any,
        ownerPersonId: personByEmail.get('khalid.hassan@dgop.local') ?? null,
        agreementUrl: 'https://dgop.local/agreements/dsa-0001',
        startAt,
        endAt,
        renewalDueAt,
        createdBy: adminEmail,
      },
    });
    const existingUsage = await prisma.dataSharingUsageMetric.findFirst({ where: { agreementId: agreement.id, note: 'Seeded monthly usage baseline.' }, select: { id: true } });
    if (!existingUsage) {
      await prisma.dataSharingUsageMetric.create({
        data: {
          agreementId: agreement.id,
          metricDate: new Date(),
          recordsShared: 12500,
          apiCalls: 2400,
          incidents: 0,
          status: 'normal' as any,
          note: 'Seeded monthly usage baseline.',
          createdBy: adminEmail,
        },
      });
    }
  }

  await prisma.abacDecisionLog.deleteMany({ where: { reason: { contains: 'Seeded:' } } });
  const patientAssetId = assetByCode.get('AST-EMR-PATIENTS');
  const financeAssetId = assetByCode.get('AST-FIN-REVENUE');
  const dqRole = roleByCode.get('dq_steward');
  const securityRole = roleByCode.get('security_reviewer');
  if (patientAssetId && dqRole) {
    await prisma.abacDecisionLog.create({
      data: {
        roleId: dqRole.id,
        assetId: patientAssetId,
        domainId: domainByCode.get('clinical') ?? null,
        classificationId: classificationByCode.get('restricted') ?? null,
        maskingPolicyId: maskingByCode.get('MSK-PERSONAL-ID') ?? null,
        requestedAction: 'read',
        decision: 'masked' as any,
        reason: 'Seeded: DQ steward receives masked patient identifiers for remediation work.',
      },
    });
  }
  if (financeAssetId && securityRole) {
    await prisma.abacDecisionLog.create({
      data: {
        roleId: securityRole.id,
        assetId: financeAssetId,
        domainId: domainByCode.get('finance') ?? null,
        classificationId: classificationByCode.get('restricted') ?? null,
        maskingPolicyId: maskingByCode.get('MSK-FINANCE-TOKEN') ?? null,
        requestedAction: 'export',
        decision: 'review_required' as any,
        reason: 'Seeded: export of restricted finance data requires owner approval.',
      },
    });
  }

  console.log(
    `Seeded: ${roles.length} roles, ${permissionCatalog.length} permissions, ` +
      `${roleTypes.length} role types, ` +
      `${classifications.length} classifications, ${statusValues.length} status values, ` +
      `${ndiDomains.length} NDI domains, ${ndiSpecifications.length} NDI specifications, ${dataDomains.length} data domains, ` +
      `${dataSubjects.length} data subjects, ${businessCapabilities.length} capabilities, ` +
      `${sampleAssets.length} data assets, ${people.length} people, ` +
      `${assignmentRules.length} assignment rules, ${directAssignments.length} direct assignments, ` +
      `${trainingCourses.length} training courses, ${certificationTracks.length} certification tracks, ` +
      `${communityArticles.length} community articles, ${expertProfiles.length} experts, ` +
      `${mentorshipPairs.length} mentorship pairs, ${sampleDataQualityIssues.length} DQ issues. ` +
      `${sampleOpenDataCandidates.length} open data candidates, ${sampleFoiRequests.length} FOI requests, ` +
      `${samplePrivacyDpias.length} privacy DPIAs, ${sampleDataSharingRequests.length} DSI requests. ` +
      `Admin user: ${adminEmail}`,
  );
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
