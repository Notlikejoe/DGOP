import { XMLParser } from 'fast-xml-parser';

const BPMN_TASK_TAGS = [
  'task',
  'userTask',
  'manualTask',
  'serviceTask',
  'businessRuleTask',
  'sendTask',
  'receiveTask',
  'scriptTask',
  'subProcess',
  'callActivity',
];

const BPMN_GATEWAY_TAGS = ['exclusiveGateway', 'parallelGateway', 'inclusiveGateway', 'eventBasedGateway'];
const VALID_TASK_TYPES = new Set(['approval', 'review', 'information']);
const VALID_ASSIGNMENT_STRATEGIES = new Set(['role', 'direct_user', 'workload', 'backup', 'manager', 'automation']);
const AUTOMATED_NODE_TYPES = new Set(['service_task', 'business_rule_task', 'script_task', 'send_task', 'receive_task']);
const ROUTING_NODE_TYPES = new Set(['exclusive_gateway', 'parallel_gateway', 'inclusive_gateway', 'event_based_gateway']);
const VALID_NODE_TYPES = new Set([
  'user_task',
  'manual_task',
  'service_task',
  'business_rule_task',
  'script_task',
  'send_task',
  'receive_task',
  'sub_process',
  'call_activity',
  'exclusive_gateway',
  'parallel_gateway',
  'inclusive_gateway',
  'event_based_gateway',
]);

export type WorkflowDesignerChecklistItem = {
  code: string;
  label: string;
  status: 'pass' | 'warning' | 'fail';
  detail: string;
};

export type WorkflowBpmnStage = {
  id?: string;
  code: string;
  nameEn: string;
  nameAr: string;
  description?: string | null;
  kind: string;
  nodeType?: string;
  taskType: string;
  assignmentStrategy?: string;
  assigneeRoleCode?: string | null;
  dueDays: number;
  formSchemaJson?: unknown | null;
  slaConfigJson?: unknown | null;
  notificationRulesJson?: unknown | null;
  evidenceRequirementsJson?: unknown | null;
  automationConfigJson?: unknown | null;
  gatewayConfigJson?: unknown | null;
  parallelGroup?: string | null;
  sortOrder: number;
  isStart: boolean;
  isDecision: boolean;
  isFinal: boolean;
  isActive: boolean;
};

export type WorkflowBpmnTransition = {
  id?: string;
  fromStageId: string;
  toStageId: string;
  labelEn: string;
  labelAr: string;
  decision?: string | null;
  conditionExpression?: string | null;
  conditionJson?: unknown | null;
  isHappyPath: boolean;
  sortOrder: number;
};

export type WorkflowBpmnTemplate = {
  id: string;
  code: string;
  caseType: string;
  nameEn: string;
  nameAr: string;
  description?: string | null;
  defaultSlaDays: number;
  stages: WorkflowBpmnStage[];
  transitions: WorkflowBpmnTransition[];
};

export type WorkflowBpmnValidation = {
  status: 'ready' | 'warning' | 'blocked';
  errors: string[];
  warnings: string[];
  stageCount: number;
  transitionCount: number;
  readinessScore: number;
  checklist: WorkflowDesignerChecklistItem[];
};

export type WorkflowBpmnParseResult = {
  stages: WorkflowBpmnStage[];
  transitions: WorkflowBpmnTransition[];
  validation: WorkflowBpmnValidation;
  designerJson: Record<string, unknown>;
};

export type WorkflowDesignerSimulationResult = {
  status: 'ready' | 'warning' | 'blocked';
  summary: {
    taskCount: number;
    decisionPoints: number;
    estimatedSlaDays: number;
    evidenceItems: number;
    notificationRules: number;
    automationSteps: number;
  };
  path: Array<{
    code: string;
    nameEn: string;
    taskType: string;
    nodeType: string;
    assigneeRoleCode?: string | null;
    dueDays: number;
    isDecision: boolean;
    isFinal: boolean;
    chosenDecision?: string | null;
    branchOptions: string[];
  }>;
  blockers: string[];
  warnings: string[];
};

type BpmnNode = {
  id: string;
  name: string;
  tag: string;
  attrs: Record<string, unknown>;
};

type BpmnFlow = {
  id: string;
  name: string;
  sourceRef: string;
  targetRef: string;
  attrs: Record<string, unknown>;
};

export function templateToBpmnXml(template: WorkflowBpmnTemplate): string {
  const stages = [...template.stages].filter((stage) => stage.isActive).sort((a, b) => a.sortOrder - b.sortOrder);
  const transitions = [...template.transitions].sort((a, b) => a.sortOrder - b.sortOrder);
  const processId = safeBpmnId(`Process_${template.code}`);
  const startId = `${processId}_Start`;
  const endId = `${processId}_End`;
  const stageIdByRef = new Map<string, string>();
  stages.forEach((stage, index) => stageIdByRef.set(stage.id ?? stage.code, safeBpmnId(`Stage_${stage.code || index + 1}`)));

  const firstStages = stages.filter((stage) => stage.isStart);
  const fallbackFirst = firstStages.length ? firstStages : stages.slice(0, 1);
  const finalStages = stages.filter((stage) => stage.isFinal);
  const fallbackFinal = finalStages.length ? finalStages : stages.slice(-1);
  const flowXml: string[] = [];
  const edgeDi: Array<{ id: string; from: string; to: string; label?: string }> = [];

  for (const stage of fallbackFirst) {
    const to = stageIdByRef.get(stage.id ?? stage.code);
    if (!to) continue;
    const id = safeBpmnId(`Flow_start_${stage.code}`);
    flowXml.push(sequenceFlow(id, startId, to, 'Start route'));
    edgeDi.push({ id, from: startId, to, label: 'Start route' });
  }

  for (const [index, transition] of transitions.entries()) {
    const from = stageIdByRef.get(transition.fromStageId);
    const to = stageIdByRef.get(transition.toStageId);
    if (!from || !to) continue;
    const label = transition.labelEn || transition.decision || 'Next step';
    const id = safeBpmnId(`Flow_${index + 1}_${from}_${to}`);
    flowXml.push(sequenceFlow(id, from, to, label, transition.conditionExpression, transition.conditionJson));
    edgeDi.push({ id, from, to, label });
  }

  for (const stage of fallbackFinal) {
    const from = stageIdByRef.get(stage.id ?? stage.code);
    if (!from) continue;
    const id = safeBpmnId(`Flow_${stage.code}_end`);
    flowXml.push(sequenceFlow(id, from, endId, 'Route complete'));
    edgeDi.push({ id, from, to: endId, label: 'Route complete' });
  }

  const taskXml = stages.map((stage) => {
    const id = stageIdByRef.get(stage.id ?? stage.code) ?? safeBpmnId(`Stage_${stage.code}`);
    const tag = bpmnTagForStage(stage);
    return [
      `    <bpmn:${tag} id="${id}" name="${escapeXml(stage.nameEn)}"`,
      ` dgop:code="${escapeXml(stage.code)}"`,
      ` dgop:kind="${escapeXml(stage.kind)}"`,
      ` dgop:nodeType="${escapeXml(stage.nodeType || 'user_task')}"`,
      ` dgop:taskType="${escapeXml(stage.taskType)}"`,
      ` dgop:assignmentStrategy="${escapeXml(stage.assignmentStrategy || 'role')}"`,
      ` dgop:dueDays="${Math.max(0, Math.round(stage.dueDays))}"`,
      ` dgop:isStart="${stage.isStart ? 'true' : 'false'}"`,
      ` dgop:isDecision="${stage.isDecision ? 'true' : 'false'}"`,
      ` dgop:isFinal="${stage.isFinal ? 'true' : 'false'}"`,
      stage.assigneeRoleCode ? ` dgop:assigneeRoleCode="${escapeXml(stage.assigneeRoleCode)}"` : '',
      stage.parallelGroup ? ` dgop:parallelGroup="${escapeXml(stage.parallelGroup)}"` : '',
      stage.formSchemaJson ? ` dgop:formSchema="${escapeXml(JSON.stringify(stage.formSchemaJson))}"` : '',
      stage.slaConfigJson ? ` dgop:slaConfig="${escapeXml(JSON.stringify(stage.slaConfigJson))}"` : '',
      stage.notificationRulesJson ? ` dgop:notificationRules="${escapeXml(JSON.stringify(stage.notificationRulesJson))}"` : '',
      stage.evidenceRequirementsJson ? ` dgop:evidenceRequirements="${escapeXml(JSON.stringify(stage.evidenceRequirementsJson))}"` : '',
      stage.automationConfigJson ? ` dgop:automationConfig="${escapeXml(JSON.stringify(stage.automationConfigJson))}"` : '',
      stage.gatewayConfigJson ? ` dgop:gatewayConfig="${escapeXml(JSON.stringify(stage.gatewayConfigJson))}"` : '',
      ` />`,
    ].join('');
  });

  const positions = layoutPositions([startId, ...stages.map((stage) => stageIdByRef.get(stage.id ?? stage.code)!), endId]);
  const shapeDi = [
    shape(startId, positions.get(startId) ?? { x: 80, y: 180 }, 36, 36),
    ...stages.map((stage) => {
      const id = stageIdByRef.get(stage.id ?? stage.code)!;
      return shape(id, positions.get(id) ?? { x: 220, y: 150 }, 154, 82);
    }),
    shape(endId, positions.get(endId) ?? { x: 520, y: 180 }, 36, 36),
  ];

  const edgeDiXml = edgeDi.map((edge) => {
    const from = positions.get(edge.from) ?? { x: 80, y: 180 };
    const to = positions.get(edge.to) ?? { x: 220, y: 180 };
    return [
      `      <bpmndi:BPMNEdge id="${edge.id}_di" bpmnElement="${edge.id}">`,
      `        <di:waypoint x="${from.x + 80}" y="${from.y + 40}" />`,
      `        <di:waypoint x="${to.x}" y="${to.y + 40}" />`,
      '      </bpmndi:BPMNEdge>',
    ].join('\n');
  });

  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<bpmn:definitions xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL"',
    '  xmlns:bpmndi="http://www.omg.org/spec/BPMN/20100524/DI"',
    '  xmlns:dc="http://www.omg.org/spec/DD/20100524/DC"',
    '  xmlns:di="http://www.omg.org/spec/DD/20100524/DI"',
    '  xmlns:dgop="https://dgop.local/bpmn"',
    `  id="${safeBpmnId(`Definitions_${template.code}`)}" targetNamespace="https://dgop.local/workflow/${escapeXml(template.code)}">`,
    `  <bpmn:process id="${processId}" name="${escapeXml(template.nameEn)}" isExecutable="true">`,
    `    <bpmn:startEvent id="${startId}" name="Start" />`,
    ...taskXml,
    `    <bpmn:endEvent id="${endId}" name="Complete" />`,
    ...flowXml,
    '  </bpmn:process>',
    '  <bpmndi:BPMNDiagram id="Diagram_1">',
    `    <bpmndi:BPMNPlane id="Plane_1" bpmnElement="${processId}">`,
    ...shapeDi,
    ...edgeDiXml,
    '    </bpmndi:BPMNPlane>',
    '  </bpmndi:BPMNDiagram>',
    '</bpmn:definitions>',
  ].join('\n');
}

export function parseBpmnXml(xml: string): WorkflowBpmnParseResult {
  if (!xml.trim()) throw new Error('BPMN XML is required');
  const parsed = new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: '@_',
    allowBooleanAttributes: true,
    parseAttributeValue: false,
    trimValues: true,
  }).parse(xml);
  const process = firstValue(findByLocalName(parsed, 'process'));
  if (!process || typeof process !== 'object') {
    throw new Error('BPMN process element is missing');
  }

  const nodes = collectNodes(process as Record<string, unknown>);
  const flows = collectFlows(process as Record<string, unknown>);
  const taskNodes = nodes.filter((node) => BPMN_TASK_TAGS.includes(localName(node.tag)));
  const stageIdByNode = new Map<string, string>();
  const stageByNode = new Map<string, WorkflowBpmnStage>();

  taskNodes.forEach((node, index) => {
    const code = normalizeStageCode(String(attr(node, 'code') ?? node.id ?? `stage_${index + 1}`), index);
    const stage: WorkflowBpmnStage = {
      id: node.id,
      code,
      nameEn: node.name || humanize(code),
      nameAr: node.name || humanize(code),
      description: null,
      kind: normalizeKind(String(attr(node, 'kind') ?? inferKind(node.name, node.tag))),
      nodeType: normalizeNodeType(String(attr(node, 'nodeType') ?? inferNodeType(node.tag))),
      taskType: normalizeTaskType(String(attr(node, 'taskType') ?? inferTaskType(node.name, node.tag))),
      assignmentStrategy: normalizeAssignmentStrategy(String(attr(node, 'assignmentStrategy') ?? 'role')),
      assigneeRoleCode: cleanString(attr(node, 'assigneeRoleCode')),
      dueDays: boundedDueDays(Number(attr(node, 'dueDays') ?? 2)),
      formSchemaJson: parseJsonAttr(attr(node, 'formSchema')),
      slaConfigJson: parseJsonAttr(attr(node, 'slaConfig')),
      notificationRulesJson: parseJsonAttr(attr(node, 'notificationRules')),
      evidenceRequirementsJson: parseJsonAttr(attr(node, 'evidenceRequirements')),
      automationConfigJson: parseJsonAttr(attr(node, 'automationConfig')),
      gatewayConfigJson: parseJsonAttr(attr(node, 'gatewayConfig')),
      parallelGroup: cleanString(attr(node, 'parallelGroup')),
      sortOrder: index + 1,
      isStart: asBool(attr(node, 'isStart')),
      isDecision: asBool(attr(node, 'isDecision')),
      isFinal: asBool(attr(node, 'isFinal')),
      isActive: true,
    };
    stageIdByNode.set(node.id, stage.code);
    stageByNode.set(node.id, stage);
  });

  const outgoing = new Map<string, BpmnFlow[]>();
  for (const flow of flows) {
    const arr = outgoing.get(flow.sourceRef) ?? [];
    arr.push(flow);
    outgoing.set(flow.sourceRef, arr);
  }

  const startIds = new Set(nodes.filter((node) => localName(node.tag) === 'startEvent').map((node) => node.id));
  const endIds = new Set(nodes.filter((node) => localName(node.tag) === 'endEvent').map((node) => node.id));

  for (const stage of stageByNode.values()) {
    stage.isStart = stage.isStart || hasIncomingFrom(stage.id!, startIds, flows, stageByNode);
    stage.isFinal = stage.isFinal || reachesAny(stage.id!, endIds, outgoing, stageByNode, new Set());
  }

  const transitions: WorkflowBpmnTransition[] = [];
  let transitionIndex = 0;
  for (const [nodeId, stage] of stageByNode.entries()) {
    const nextStages = nextStageTargets(nodeId, outgoing, stageByNode, new Set());
    if (nextStages.length > 1) stage.isDecision = true;
    for (const next of nextStages) {
      if (next.nodeId === nodeId) continue;
      transitionIndex++;
      const decision = inferDecision(next.label, nextStages.length > 1);
      transitions.push({
        id: `${stage.code}->${next.stage.code}:${transitionIndex}`,
        fromStageId: stage.code,
        toStageId: next.stage.code,
        labelEn: next.label || decision || 'Next step',
        labelAr: next.label || decision || 'Next step',
        decision,
        conditionExpression: cleanString(next.flow ? attrFromAttrs(next.flow.attrs, 'conditionExpression') : null),
        conditionJson: next.flow ? parseJsonAttr(attrFromAttrs(next.flow.attrs, 'conditionJson')) : null,
        isHappyPath: decision !== 'rejected',
        sortOrder: transitionIndex,
      });
    }
  }

  const orderedStages = orderStages([...stageByNode.values()], transitions);
  orderedStages.forEach((stage, index) => stage.sortOrder = index + 1);
  if (orderedStages.length && !orderedStages.some((stage) => stage.isStart)) orderedStages[0].isStart = true;
  if (orderedStages.length && !orderedStages.some((stage) => stage.isFinal)) orderedStages[orderedStages.length - 1].isFinal = true;

  const validation = validateWorkflowRoute(orderedStages, transitions);
  return {
    stages: orderedStages,
    transitions,
    validation,
    designerJson: {
      source: 'bpmn',
      importedAt: new Date().toISOString(),
      nodeCount: nodes.length,
      flowCount: flows.length,
      stages: orderedStages.map((stage) => ({ ...stage })),
      transitions: transitions.map((transition) => ({ ...transition })),
    },
  };
}

export function validateWorkflowRoute(
  stages: WorkflowBpmnStage[],
  transitions: WorkflowBpmnTransition[],
): WorkflowBpmnValidation {
  const errors: string[] = [];
  const warnings: string[] = [];
  const checklist: WorkflowDesignerChecklistItem[] = [];
  const activeStages = stages.filter((stage) => stage.isActive);
  const stageCodes = new Set<string>();

  if (activeStages.length === 0) errors.push('Route must contain at least one workflow task stage.');
  for (const stage of activeStages) {
    const nodeType = stageNodeType(stage);
    if (!stage.code) errors.push('Every stage needs a stable code.');
    if (stageCodes.has(stage.code)) errors.push(`Duplicate stage code: ${stage.code}.`);
    stageCodes.add(stage.code);
    if (!stage.nameEn?.trim()) errors.push(`Stage ${stage.code} needs a user-readable name.`);
    if (!VALID_NODE_TYPES.has(nodeType)) errors.push(`Stage ${stage.code} uses an unsupported BPMN node type.`);
    if (!VALID_TASK_TYPES.has(stage.taskType)) errors.push(`Stage ${stage.code} uses an unsupported task type.`);
    if (!VALID_ASSIGNMENT_STRATEGIES.has(stage.assignmentStrategy || 'role')) {
      errors.push(`Stage ${stage.code} uses an unsupported assignment strategy.`);
    }
    if (stage.dueDays < 0 || stage.dueDays > 365) errors.push(`Stage ${stage.code} has an invalid SLA day value.`);
    if (!stage.assigneeRoleCode && !AUTOMATED_NODE_TYPES.has(nodeType) && !ROUTING_NODE_TYPES.has(nodeType) && !stage.isFinal && !isPassiveRoutingStage(stage)) {
      errors.push(`Stage ${stage.code} needs a responsible role before it can create work.`);
    }
    if (ROUTING_NODE_TYPES.has(nodeType) && !hasStructuredRequirement(stage.gatewayConfigJson)) {
      warnings.push(`Gateway stage ${stage.code} should define branch rules or routing conditions.`);
    }
    if (stage.taskType === 'approval' && !hasStructuredRequirement(stage.evidenceRequirementsJson)) {
      warnings.push(`Approval stage ${stage.code} should define evidence requirements.`);
    }
    if ((stage.kind === 'intake' || stage.taskType === 'information') && !hasStructuredRequirement(stage.formSchemaJson)) {
      warnings.push(`Information stage ${stage.code} should define the form fields users must complete.`);
    }
    if (AUTOMATED_NODE_TYPES.has(stageNodeType(stage)) && !hasStructuredRequirement(stage.automationConfigJson)) {
      warnings.push(`Automated stage ${stage.code} should define the integration, rule, or service action.`);
    }
  }

  if (activeStages.length && !activeStages.some((stage) => stage.isStart)) errors.push('Route needs at least one start stage.');
  if (activeStages.length && !activeStages.some((stage) => stage.isFinal)) errors.push('Route needs at least one final stage.');

  for (const transition of transitions) {
    if (!stageCodes.has(transition.fromStageId)) errors.push(`Transition starts from an unknown stage: ${transition.fromStageId}.`);
    if (!stageCodes.has(transition.toStageId)) errors.push(`Transition ends at an unknown stage: ${transition.toStageId}.`);
  }

  const outgoingByStage = new Map<string, WorkflowBpmnTransition[]>();
  const transitionKeys = new Set<string>();
  for (const transition of transitions) {
    if (transition.fromStageId === transition.toStageId) errors.push(`Transition from ${transition.fromStageId} points back to the same stage.`);
    const transitionKey = `${transition.fromStageId}->${transition.toStageId}:${transition.decision ?? transition.conditionExpression ?? transition.labelEn}`;
    if (transitionKeys.has(transitionKey)) warnings.push(`Duplicate transition detected: ${transitionKey}.`);
    transitionKeys.add(transitionKey);
    if (!transition.labelEn?.trim()) warnings.push(`Transition from ${transition.fromStageId} to ${transition.toStageId} needs a readable label.`);
    const arr = outgoingByStage.get(transition.fromStageId) ?? [];
    arr.push(transition);
    outgoingByStage.set(transition.fromStageId, arr);
  }
  const finalCodes = new Set(activeStages.filter((stage) => stage.isFinal).map((stage) => stage.code));
  for (const stage of activeStages) {
    const outgoing = outgoingByStage.get(stage.code) ?? [];
    if (stage.isFinal && outgoing.length > 0) warnings.push(`Final stage ${stage.code} should not send users to another stage.`);
    if (!stage.isFinal && activeStages.length > 1 && outgoing.length === 0) {
      errors.push(`Stage ${stage.code} is not final and has no next step.`);
    }
    if (outgoing.length > 1 && !stage.isDecision) {
      warnings.push(`Stage ${stage.code} has multiple exits and was marked as a decision point.`);
      stage.isDecision = true;
    }
    if (stage.isDecision && outgoing.length < 2) {
      warnings.push(`Decision stage ${stage.code} should have at least two branches.`);
    }
    if (stage.isDecision && outgoing.length > 1 && !outgoing.some((transition) => !transition.isHappyPath || transition.decision === 'rejected')) {
      warnings.push(`Decision stage ${stage.code} should include a rejection or rework path.`);
    }
    if (outgoing.length > 1) {
      const branchLabels = new Set<string>();
      for (const transition of outgoing) {
        const label = (transition.decision || transition.conditionExpression || transition.labelEn || '').trim().toLowerCase();
        if (!label) warnings.push(`A branch leaving ${stage.code} needs a user-readable condition or decision label.`);
        if (label && branchLabels.has(label)) warnings.push(`Decision stage ${stage.code} has duplicate branch labels.`);
        if (label) branchLabels.add(label);
      }
    }
  }

  const reachable = reachableStageCodes(activeStages, transitions);
  for (const stage of activeStages) {
    if (!reachable.has(stage.code)) warnings.push(`Stage ${stage.code} is not reachable from the start stage.`);
    if (!stage.isFinal && finalCodes.size && !canReachAnyFinal(stage.code, finalCodes, outgoingByStage, new Set())) {
      errors.push(`Stage ${stage.code} cannot reach a final stage.`);
    }
  }

  checklist.push(...buildEnterpriseChecklist(activeStages, transitions, errors, warnings));
  const failCount = checklist.filter((item) => item.status === 'fail').length;
  const warningCount = checklist.filter((item) => item.status === 'warning').length;
  const readinessScore = checklist.length
    ? Math.max(0, Math.round(((checklist.length - failCount - warningCount * 0.45) / checklist.length) * 100))
    : 0;

  return {
    status: errors.length ? 'blocked' : warnings.length ? 'warning' : 'ready',
    errors,
    warnings,
    stageCount: activeStages.length,
    transitionCount: transitions.length,
    readinessScore,
    checklist,
  };
}

export function simulateWorkflowRoute(
  stages: WorkflowBpmnStage[],
  transitions: WorkflowBpmnTransition[],
  decisions: Record<string, string | null | undefined> = {},
): WorkflowDesignerSimulationResult {
  const validation = validateWorkflowRoute(stages, transitions);
  const activeStages = [...stages].filter((stage) => stage.isActive).sort((a, b) => a.sortOrder - b.sortOrder);
  const stageByCode = new Map(activeStages.map((stage) => [stage.code, stage]));
  const outgoing = new Map<string, WorkflowBpmnTransition[]>();
  transitions.forEach((transition) => {
    const arr = outgoing.get(transition.fromStageId) ?? [];
    arr.push(transition);
    outgoing.set(transition.fromStageId, arr);
  });
  const path: WorkflowDesignerSimulationResult['path'] = [];
  const blockers: string[] = [...validation.errors];
  const warnings: string[] = [...validation.warnings];
  let current: WorkflowBpmnStage | null = activeStages.find((stage) => stage.isStart) ?? activeStages[0] ?? null;
  const seen = new Set<string>();
  let guard = 0;

  while (current && guard < 80) {
    guard++;
    if (seen.has(current.code)) {
      warnings.push(`Simulation stopped at ${current.code} because the route loops back to an earlier stage.`);
      break;
    }
    seen.add(current.code);
    const outgoingEdges = [...(outgoing.get(current.code) ?? [])].sort((a, b) => a.sortOrder - b.sortOrder);
    const requestedDecision = decisions[current.code] ?? null;
    const selected = selectSimulationTransition(outgoingEdges, requestedDecision);
    path.push({
      code: current.code,
      nameEn: current.nameEn,
      taskType: current.taskType,
      nodeType: stageNodeType(current),
      assigneeRoleCode: current.assigneeRoleCode ?? null,
      dueDays: Math.max(0, current.dueDays ?? 0),
      isDecision: current.isDecision,
      isFinal: current.isFinal,
      chosenDecision: selected?.decision ?? requestedDecision ?? null,
      branchOptions: outgoingEdges.map((edge) => edge.decision || edge.conditionExpression || edge.labelEn).filter(Boolean),
    });
    if (current.isFinal || !selected) break;
    current = stageByCode.get(selected.toStageId) ?? null;
  }
  if (guard >= 80) blockers.push('Simulation exceeded the maximum route depth; check for an uncontrolled loop.');

  const automationSteps = path.filter((stage) => AUTOMATED_NODE_TYPES.has(stage.nodeType)).length;
  const evidenceItems = activeStages.reduce((total, stage) => total + requirementCount(stage.evidenceRequirementsJson), 0);
  const notificationRules = activeStages.reduce((total, stage) => total + requirementCount(stage.notificationRulesJson), 0);
  const estimatedSlaDays = path.reduce((total, stage) => total + Math.max(0, stage.dueDays), 0);

  return {
    status: blockers.length ? 'blocked' : warnings.length ? 'warning' : 'ready',
    summary: {
      taskCount: path.length,
      decisionPoints: path.filter((stage) => stage.isDecision).length,
      estimatedSlaDays,
      evidenceItems,
      notificationRules,
      automationSteps,
    },
    path,
    blockers,
    warnings,
  };
}

function selectSimulationTransition(
  outgoing: WorkflowBpmnTransition[],
  requestedDecision?: string | null,
): WorkflowBpmnTransition | null {
  if (!outgoing.length) return null;
  if (requestedDecision) {
    const requested = requestedDecision.toLowerCase();
    return outgoing.find((edge) =>
      [edge.decision, edge.conditionExpression, edge.labelEn]
        .filter(Boolean)
        .some((value) => String(value).toLowerCase() === requested),
    ) ?? null;
  }
  return outgoing.find((edge) => edge.isHappyPath) ?? outgoing[0];
}

function buildEnterpriseChecklist(
  stages: WorkflowBpmnStage[],
  transitions: WorkflowBpmnTransition[],
  errors: string[],
  warnings: string[],
): WorkflowDesignerChecklistItem[] {
  const hasStart = stages.some((stage) => stage.isStart);
  const hasFinal = stages.some((stage) => stage.isFinal);
  const humanStages = stages.filter((stage) => !AUTOMATED_NODE_TYPES.has(stageNodeType(stage)) && !isPassiveRoutingStage(stage));
  const assigned = humanStages.filter((stage) => stage.assigneeRoleCode || stage.isFinal).length;
  const approvals = stages.filter((stage) => stage.taskType === 'approval');
  const approvalsWithEvidence = approvals.filter((stage) => hasStructuredRequirement(stage.evidenceRequirementsJson)).length;
  const informationStages = stages.filter((stage) => stage.kind === 'intake' || stage.taskType === 'information');
  const forms = informationStages.filter((stage) => hasStructuredRequirement(stage.formSchemaJson)).length;
  const decisionStages = stages.filter((stage) => stage.isDecision);
  const decisionEdges = decisionStages.filter((stage) => transitions.filter((edge) => edge.fromStageId === stage.code).length >= 2).length;
  const notificationStages = stages.filter((stage) => hasStructuredRequirement(stage.notificationRulesJson)).length;
  const automatedStages = stages.filter((stage) => AUTOMATED_NODE_TYPES.has(stageNodeType(stage)));
  const automatedReady = automatedStages.filter((stage) => hasStructuredRequirement(stage.automationConfigJson)).length;

  return [
    checklistItem('route_shape', 'Route has a clear start and end', hasStart && hasFinal, hasStart || hasFinal, `${stages.length} stages, ${transitions.length} transitions`),
    checklistItem('owners', 'Every human stage has a responsible role', humanStages.length === assigned, assigned > 0, `${assigned}/${humanStages.length} human stages assigned`),
    checklistItem('decisions', 'Decision branches are explicit', decisionStages.length === decisionEdges, decisionEdges > 0 || decisionStages.length === 0, `${decisionEdges}/${decisionStages.length} decision stages have branches`),
    checklistItem('forms', 'Intake and information stages define forms', informationStages.length === 0 || forms === informationStages.length, forms > 0, `${forms}/${informationStages.length} information stages have form schemas`),
    checklistItem('evidence', 'Approval stages define evidence', approvals.length === 0 || approvalsWithEvidence === approvals.length, approvalsWithEvidence > 0, `${approvalsWithEvidence}/${approvals.length} approval stages have evidence requirements`),
    checklistItem('notifications', 'Notifications are configured', notificationStages === stages.length, notificationStages > 0, `${notificationStages}/${stages.length} stages define notifications`),
    checklistItem('automation', 'Automated stages have executable rules', automatedStages.length === automatedReady, automatedReady > 0 || automatedStages.length === 0, `${automatedReady}/${automatedStages.length} automated stages configured`),
    checklistItem('publish_safety', 'No blocking publish issues', errors.length === 0, warnings.length === 0, `${errors.length} blockers, ${warnings.length} warnings`),
  ];
}

function checklistItem(
  code: string,
  label: string,
  pass: boolean,
  partial: boolean,
  detail: string,
): WorkflowDesignerChecklistItem {
  return { code, label, status: pass ? 'pass' : partial ? 'warning' : 'fail', detail };
}

function hasStructuredRequirement(value: unknown | null | undefined): boolean {
  if (!value) return false;
  if (Array.isArray(value)) return value.length > 0;
  if (typeof value === 'object') return Object.keys(value as Record<string, unknown>).length > 0;
  return Boolean(String(value).trim());
}

function requirementCount(value: unknown | null | undefined): number {
  if (!value) return 0;
  if (Array.isArray(value)) return value.length;
  if (typeof value === 'object') return Object.keys(value as Record<string, unknown>).length;
  return String(value).trim() ? 1 : 0;
}

function isPassiveRoutingStage(stage: WorkflowBpmnStage): boolean {
  if (ROUTING_NODE_TYPES.has(stageNodeType(stage))) return true;
  return !stage.assigneeRoleCode &&
    !stage.isFinal &&
    (stage.isStart || stage.kind === 'intake') &&
    stage.taskType === 'information';
}

function sequenceFlow(
  id: string,
  from: string,
  to: string,
  label: string,
  conditionExpression?: string | null,
  conditionJson?: unknown | null,
): string {
  const conditionAttrs = [
    conditionExpression ? ` dgop:conditionExpression="${escapeXml(conditionExpression)}"` : '',
    conditionJson ? ` dgop:conditionJson="${escapeXml(JSON.stringify(conditionJson))}"` : '',
  ].join('');
  return `    <bpmn:sequenceFlow id="${id}" name="${escapeXml(label)}" sourceRef="${from}" targetRef="${to}"${conditionAttrs} />`;
}

function shape(id: string, pos: { x: number; y: number }, width: number, height: number): string {
  return [
    `      <bpmndi:BPMNShape id="${id}_di" bpmnElement="${id}">`,
    `        <dc:Bounds x="${pos.x}" y="${pos.y}" width="${width}" height="${height}" />`,
    '      </bpmndi:BPMNShape>',
  ].join('\n');
}

function layoutPositions(ids: string[]): Map<string, { x: number; y: number }> {
  const map = new Map<string, { x: number; y: number }>();
  ids.forEach((id, index) => {
    map.set(id, { x: 70 + index * 210, y: 150 + (index % 2 === 0 ? 0 : 18) });
  });
  return map;
}

function collectNodes(process: Record<string, unknown>): BpmnNode[] {
  const nodes: BpmnNode[] = [];
  for (const [tag, raw] of Object.entries(process)) {
    const name = localName(tag);
    if (![...BPMN_TASK_TAGS, ...BPMN_GATEWAY_TAGS, 'startEvent', 'endEvent'].includes(name)) continue;
    for (const item of arrayify(raw)) {
      if (!item || typeof item !== 'object') continue;
      const attrs = item as Record<string, unknown>;
      const id = String(attrs['@_id'] ?? '');
      if (!id) continue;
      nodes.push({ id, name: String(attrs['@_name'] ?? ''), tag, attrs });
    }
  }
  return nodes;
}

function collectFlows(process: Record<string, unknown>): BpmnFlow[] {
  const sequenceFlows = findByLocalName(process, 'sequenceFlow').flatMap((raw) => arrayify(raw));
  return sequenceFlows.flatMap((item) => {
    if (!item || typeof item !== 'object') return [];
    const attrs = item as Record<string, unknown>;
    const id = String(attrs['@_id'] ?? '');
    const sourceRef = String(attrs['@_sourceRef'] ?? '');
    const targetRef = String(attrs['@_targetRef'] ?? '');
    if (!id || !sourceRef || !targetRef) return [];
    return [{ id, name: String(attrs['@_name'] ?? ''), sourceRef, targetRef, attrs }];
  });
}

function nextStageTargets(
  nodeId: string,
  outgoing: Map<string, BpmnFlow[]>,
  stageByNode: Map<string, WorkflowBpmnStage>,
  seen: Set<string>,
): Array<{ nodeId: string; stage: WorkflowBpmnStage; label: string; flow?: BpmnFlow }> {
  if (seen.has(nodeId)) return [];
  seen.add(nodeId);
  const results: Array<{ nodeId: string; stage: WorkflowBpmnStage; label: string; flow?: BpmnFlow }> = [];
  for (const flow of outgoing.get(nodeId) ?? []) {
    const stage = stageByNode.get(flow.targetRef);
    if (stage) {
      results.push({ nodeId: flow.targetRef, stage, label: flow.name, flow });
      continue;
    }
    for (const nested of nextStageTargets(flow.targetRef, outgoing, stageByNode, new Set(seen))) {
      results.push({ ...nested, label: flow.name || nested.label, flow: nested.flow ?? flow });
    }
  }
  return dedupeTargets(results);
}

function reachesAny(
  nodeId: string,
  targets: Set<string>,
  outgoing: Map<string, BpmnFlow[]>,
  stageByNode: Map<string, WorkflowBpmnStage>,
  seen: Set<string>,
): boolean {
  if (seen.has(nodeId)) return false;
  seen.add(nodeId);
  for (const flow of outgoing.get(nodeId) ?? []) {
    if (targets.has(flow.targetRef)) return true;
    if (stageByNode.has(flow.targetRef)) continue;
    if (reachesAny(flow.targetRef, targets, outgoing, stageByNode, seen)) return true;
  }
  return false;
}

function hasIncomingFrom(
  nodeId: string,
  sourceIds: Set<string>,
  flows: BpmnFlow[],
  stageByNode: Map<string, WorkflowBpmnStage>,
): boolean {
  const incoming = flows.filter((flow) => flow.targetRef === nodeId);
  if (incoming.some((flow) => sourceIds.has(flow.sourceRef))) return true;
  for (const flow of incoming) {
    if (stageByNode.has(flow.sourceRef)) continue;
    if (hasIncomingFrom(flow.sourceRef, sourceIds, flows, stageByNode)) return true;
  }
  return false;
}

function orderStages(stages: WorkflowBpmnStage[], transitions: WorkflowBpmnTransition[]): WorkflowBpmnStage[] {
  const byCode = new Map(stages.map((stage) => [stage.code, stage]));
  const outgoing = new Map<string, WorkflowBpmnTransition[]>();
  transitions.forEach((transition) => {
    const arr = outgoing.get(transition.fromStageId) ?? [];
    arr.push(transition);
    outgoing.set(transition.fromStageId, arr);
  });
  const ordered: WorkflowBpmnStage[] = [];
  const seen = new Set<string>();
  const queue = stages.filter((stage) => stage.isStart);
  if (!queue.length && stages[0]) queue.push(stages[0]);
  while (queue.length) {
    const stage = queue.shift()!;
    if (seen.has(stage.code)) continue;
    seen.add(stage.code);
    ordered.push(stage);
    for (const transition of outgoing.get(stage.code) ?? []) {
      const next = byCode.get(transition.toStageId);
      if (next && !seen.has(next.code)) queue.push(next);
    }
  }
  for (const stage of stages) {
    if (!seen.has(stage.code)) ordered.push(stage);
  }
  return ordered;
}

function reachableStageCodes(stages: WorkflowBpmnStage[], transitions: WorkflowBpmnTransition[]): Set<string> {
  const reachable = new Set<string>();
  const queue = stages.filter((stage) => stage.isStart).map((stage) => stage.code);
  while (queue.length) {
    const code = queue.shift()!;
    if (reachable.has(code)) continue;
    reachable.add(code);
    transitions
      .filter((transition) => transition.fromStageId === code)
      .forEach((transition) => {
        if (!reachable.has(transition.toStageId)) queue.push(transition.toStageId);
      });
  }
  return reachable;
}

function canReachAnyFinal(
  stageCode: string,
  finalCodes: Set<string>,
  outgoingByStage: Map<string, WorkflowBpmnTransition[]>,
  seen: Set<string>,
): boolean {
  if (finalCodes.has(stageCode)) return true;
  if (seen.has(stageCode)) return false;
  seen.add(stageCode);
  for (const transition of outgoingByStage.get(stageCode) ?? []) {
    if (canReachAnyFinal(transition.toStageId, finalCodes, outgoingByStage, seen)) return true;
  }
  return false;
}

function dedupeTargets(targets: Array<{ nodeId: string; stage: WorkflowBpmnStage; label: string; flow?: BpmnFlow }>) {
  const seen = new Set<string>();
  return targets.filter((target) => {
    const key = `${target.nodeId}:${target.label}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function findByLocalName(obj: unknown, target: string): unknown[] {
  if (!obj || typeof obj !== 'object') return [];
  const matches: unknown[] = [];
  for (const [key, value] of Object.entries(obj as Record<string, unknown>)) {
    if (localName(key) === target) matches.push(value);
    matches.push(...findByLocalName(value, target));
  }
  return matches;
}

function attr(node: BpmnNode, name: string): unknown {
  return node.attrs[`@_dgop:${name}`] ?? node.attrs[`@_${name}`] ?? node.attrs[`@_camunda:${name}`];
}

function attrFromAttrs(attrs: Record<string, unknown>, name: string): unknown {
  return attrs[`@_dgop:${name}`] ?? attrs[`@_${name}`] ?? attrs[`@_camunda:${name}`];
}

function arrayify<T>(value: T | T[] | undefined): T[] {
  if (value == null) return [];
  return Array.isArray(value) ? value : [value];
}

function firstValue(values: unknown[]): unknown {
  const first = values[0];
  return Array.isArray(first) ? first[0] : first;
}

function localName(tag: string): string {
  return tag.includes(':') ? tag.split(':').pop() ?? tag : tag;
}

function cleanString(value: unknown): string | null {
  const text = String(value ?? '').trim();
  return text || null;
}

function asBool(value: unknown): boolean {
  return String(value ?? '').toLowerCase() === 'true';
}

function boundedDueDays(value: number): number {
  if (!Number.isFinite(value)) return 2;
  return Math.min(Math.max(Math.round(value), 0), 365);
}

function normalizeStageCode(value: string, index: number): string {
  const clean = value
    .replace(/^Stage_/i, '')
    .replace(/[^a-zA-Z0-9_-]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .toLowerCase();
  return clean || `stage_${index + 1}`;
}

function normalizeKind(value: string): string {
  const clean = value.toLowerCase().replace(/[^a-z0-9_-]+/g, '_');
  return clean || 'review';
}

function normalizeTaskType(value: string): string {
  const clean = value.toLowerCase().replace(/[^a-z0-9_-]+/g, '_');
  return VALID_TASK_TYPES.has(clean) ? clean : 'review';
}

function normalizeNodeType(value: string): string {
  const clean = value.toLowerCase().replace(/[^a-z0-9_-]+/g, '_');
  if (!clean) return 'user_task';
  if (clean === 'usertask') return 'user_task';
  if (clean === 'manualtask') return 'manual_task';
  if (clean === 'servicetask') return 'service_task';
  if (clean === 'businessruletask') return 'business_rule_task';
  if (clean === 'scripttask') return 'script_task';
  if (clean === 'sendtask') return 'send_task';
  if (clean === 'receivetask') return 'receive_task';
  return clean;
}

function stageNodeType(stage: WorkflowBpmnStage): string {
  return normalizeNodeType(stage.nodeType || 'user_task');
}

function normalizeAssignmentStrategy(value: string): string {
  const clean = value.toLowerCase().replace(/[^a-z0-9_-]+/g, '_');
  return VALID_ASSIGNMENT_STRATEGIES.has(clean) ? clean : 'role';
}

function inferNodeType(tag: string): string {
  const name = localName(tag);
  if (name === 'manualTask') return 'manual_task';
  if (name === 'serviceTask') return 'service_task';
  if (name === 'businessRuleTask') return 'business_rule_task';
  if (name === 'scriptTask') return 'script_task';
  if (name === 'sendTask') return 'send_task';
  if (name === 'receiveTask') return 'receive_task';
  if (name === 'subProcess') return 'sub_process';
  if (name === 'callActivity') return 'call_activity';
  if (name === 'exclusiveGateway') return 'exclusive_gateway';
  if (name === 'parallelGateway') return 'parallel_gateway';
  if (name === 'inclusiveGateway') return 'inclusive_gateway';
  if (name === 'eventBasedGateway') return 'event_based_gateway';
  return 'user_task';
}

function bpmnTagForStage(stage: WorkflowBpmnStage): string {
  const type = normalizeNodeType(stage.nodeType || 'user_task');
  if (type === 'manual_task') return 'manualTask';
  if (type === 'service_task') return 'serviceTask';
  if (type === 'business_rule_task') return 'businessRuleTask';
  if (type === 'script_task') return 'scriptTask';
  if (type === 'send_task') return 'sendTask';
  if (type === 'receive_task') return 'receiveTask';
  if (type === 'sub_process') return 'subProcess';
  if (type === 'call_activity') return 'callActivity';
  return 'userTask';
}

function parseJsonAttr(value: unknown): unknown | null {
  const text = cleanString(value);
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function inferKind(name: string, tag: string): string {
  const text = `${name} ${tag}`.toLowerCase();
  if (text.includes('intake') || text.includes('start')) return 'intake';
  if (text.includes('triage')) return 'triage';
  if (text.includes('root') || text.includes('analysis') || text.includes('impact')) return 'analysis';
  if (text.includes('decision') || text.includes('approve')) return 'decision';
  if (text.includes('implement') || text.includes('remediate')) return 'implementation';
  if (text.includes('validat') || text.includes('test')) return 'validation';
  if (text.includes('close') || text.includes('complete')) return 'closure';
  return 'review';
}

function inferTaskType(name: string, tag: string): string {
  const text = `${name} ${tag}`.toLowerCase();
  if (text.includes('approve') || text.includes('decision') || tag.includes('businessRuleTask')) return 'approval';
  if (text.includes('intake') || text.includes('information') || text.includes('capture')) return 'information';
  return 'review';
}

function inferDecision(label: string, hasMultipleBranches: boolean): string | null {
  const text = label.toLowerCase();
  if (/(reject|deny|decline|rework|revise|more|correction|no|fail|block)/.test(text)) return 'rejected';
  if (/(approve|accept|complete|yes|pass|publish|close)/.test(text)) return 'approved';
  return hasMultipleBranches ? null : null;
}

function humanize(value: string): string {
  return value
    .replace(/[_-]+/g, ' ')
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

function safeBpmnId(value: string): string {
  const cleaned = value.replace(/[^a-zA-Z0-9_]+/g, '_').replace(/^_+|_+$/g, '');
  return /^[a-zA-Z_]/.test(cleaned) ? cleaned : `Bpmn_${cleaned}`;
}

function escapeXml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}
