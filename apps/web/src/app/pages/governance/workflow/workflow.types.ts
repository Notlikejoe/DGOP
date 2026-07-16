import { StatusKind } from '../../../shared/status-chip';

export interface Ref { id: string; code?: string; nameEn: string; nameAr: string; }
export interface UserRef { id: string; email: string; displayName: string; }
export interface TaskCaseRef { id: string; code: string; title: string; type: string; status: string; }

export interface Task {
  id: string;
  caseId: string;
  title: string;
  type: string;
  status: string;
  assigneeUserId?: string | null;
  dueDate?: string | null;
  decision?: string | null;
  decisionComment?: string | null;
  completedAt?: string | null;
  slaStatus: string;
  assignee?: UserRef | null;
  case?: TaskCaseRef | null;
}

export interface CaseEvent {
  id: string;
  action: string;
  actor: string;
  fromStatus?: string | null;
  toStatus?: string | null;
  comment?: string | null;
  createdAt: string;
}

export interface CaseRow {
  id: string;
  code: string;
  title: string;
  description?: string | null;
  type: string;
  status: string;
  templateId?: string | null;
  template?: { id: string; code: string; caseType: string; nameEn: string; nameAr: string } | null;
  assetId?: string | null;
  asset?: {
    id: string;
    code: string;
    nameEn: string;
    nameAr: string;
    domain?: Ref | null;
  } | null;
  assignment?: {
    id: string;
    approvalStatus: string;
    roleType: { nameEn: string; nameAr: string };
    person: { fullNameEn: string; fullNameAr: string };
  } | null;
  openTasks?: number;
  tasks: Task[];
  events?: CaseEvent[];
}

export interface WorkflowTemplateStage {
  id: string;
  code: string;
  nameEn: string;
  nameAr: string;
  description?: string | null;
  kind: string;
  taskType: string;
  assigneeRoleCode?: string | null;
  dueDays: number;
  sortOrder: number;
  isStart: boolean;
  isDecision: boolean;
  isFinal: boolean;
  isActive: boolean;
}

export interface WorkflowTemplateTransition {
  id: string;
  fromStageId: string;
  toStageId: string;
  labelEn: string;
  labelAr: string;
  decision?: string | null;
  isHappyPath: boolean;
}

export interface WorkflowTemplate {
  id: string;
  code: string;
  caseType: string;
  nameEn: string;
  nameAr: string;
  description?: string | null;
  trigger: string;
  domain?: Ref | null;
  defaultSlaDays: number;
  stages: WorkflowTemplateStage[];
  transitions: WorkflowTemplateTransition[];
  _count?: { cases: number; stages: number };
}

export interface WorkflowGraphNode {
  id: string;
  type: 'template' | 'stage' | 'domain' | 'case';
  refId?: string | null;
  labelEn: string;
  labelAr: string;
  sublabelEn?: string | null;
  sublabelAr?: string | null;
  status?: string | null;
  count?: number | null;
  x: number;
  y: number;
}

export interface WorkflowGraphEdge {
  id: string;
  from: string;
  to: string;
  labelEn: string;
  labelAr: string;
  tone?: string | null;
}

export interface WorkflowGraph {
  summary: {
    templates: number;
    stages: number;
    activeCases: number;
    overdueTasks: number;
    domainsCovered: number;
  };
  templates: WorkflowTemplate[];
  nodes: WorkflowGraphNode[];
  edges: WorkflowGraphEdge[];
}

export interface WorkflowRoutePreview {
  caseType: string;
  domainId?: string | null;
  template: WorkflowTemplate;
  stages: WorkflowTemplateStage[];
  transitions: WorkflowTemplateTransition[];
  warnings: string[];
}

export const SLA_KIND: Record<string, StatusKind> = {
  on_track: 'success',
  at_risk: 'warning',
  overdue: 'danger',
  done: 'muted',
  none: 'muted',
};

export const CASE_STATUS_KIND: Record<string, StatusKind> = {
  draft: 'muted',
  submitted: 'info',
  under_review: 'info',
  awaiting_information: 'warning',
  decision_made: 'info',
  approved: 'success',
  implemented: 'success',
  rejected: 'danger',
  closed: 'muted',
};

export const APPROVAL_KIND: Record<string, StatusKind> = {
  draft: 'muted',
  pending: 'warning',
  approved: 'success',
  rejected: 'danger',
};
