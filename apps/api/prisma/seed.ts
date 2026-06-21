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
    'audit.view',
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
    'audit.view',
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

  // Seed the initial admin user (local dev only).
  const adminEmail = process.env.SEED_ADMIN_EMAIL ?? 'admin@dgop.local';
  const adminPassword = process.env.SEED_ADMIN_PASSWORD ?? 'Admin@12345';
  const passwordHash = await bcrypt.hash(adminPassword, 10);
  const admin = await prisma.user.upsert({
    where: { email: adminEmail },
    update: { displayName: 'System Administrator', isActive: true },
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
  const personPasswordHash = await bcrypt.hash(process.env.SEED_PERSON_PASSWORD ?? 'Password@123', 10);
  for (const p of people) {
    const user = await prisma.user.upsert({
      where: { email: p.email },
      update: { displayName: p.fullNameEn, isActive: true },
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

  console.log(
    `Seeded: ${roles.length} roles, ${permissionCatalog.length} permissions, ` +
      `${roleTypes.length} role types, ` +
      `${classifications.length} classifications, ${statusValues.length} status values, ` +
      `${ndiDomains.length} NDI domains, ${ndiSpecifications.length} NDI specifications, ${dataDomains.length} data domains, ` +
      `${dataSubjects.length} data subjects, ${businessCapabilities.length} capabilities, ` +
      `${sampleAssets.length} data assets, ${people.length} people, ` +
      `${assignmentRules.length} assignment rules, ${directAssignments.length} direct assignments. ` +
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
