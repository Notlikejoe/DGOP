export const WORKFLOW_AUTOMATION_ACTIONS = [
  'invoke_connector',
  'set_runtime_variables',
  'record_control_event',
] as const;

export type WorkflowAutomationAction = (typeof WORKFLOW_AUTOMATION_ACTIONS)[number];

export type WorkflowAutomationValidation = {
  valid: boolean;
  action: WorkflowAutomationAction | null;
  errors: string[];
};

const ACTIONS = new Set<string>(WORKFLOW_AUTOMATION_ACTIONS);
const CONTROL_EVENT_PATTERN = /^[a-z][a-z0-9_.-]{2,79}$/u;
const MAX_VARIABLES_PER_ACTION = 50;

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

export function validateWorkflowAutomationConfig(value: unknown): WorkflowAutomationValidation {
  const config = record(value);
  const rawAction = typeof config['action'] === 'string' ? config['action'].trim().toLowerCase() : '';
  const action = ACTIONS.has(rawAction) ? rawAction as WorkflowAutomationAction : null;
  const errors: string[] = [];

  if (!action) {
    errors.push(`action must be one of: ${WORKFLOW_AUTOMATION_ACTIONS.join(', ')}`);
    return { valid: false, action: null, errors };
  }

  if (action === 'invoke_connector') {
    const connectorId = typeof config['connectorId'] === 'string' ? config['connectorId'].trim() : '';
    const connectorCode = typeof config['connectorCode'] === 'string' ? config['connectorCode'].trim() : '';
    if (!connectorId && !connectorCode) errors.push('connectorId or connectorCode is required');
    if (config['endpoint'] !== undefined && !['health', 'writeback'].includes(String(config['endpoint']))) {
      errors.push('endpoint must be health or writeback');
    }
  }

  if (action === 'set_runtime_variables') {
    const values = record(config['values']);
    const keys = Object.keys(values);
    if (!keys.length) errors.push('values must contain at least one workflow variable');
    if (keys.length > MAX_VARIABLES_PER_ACTION) errors.push(`values cannot contain more than ${MAX_VARIABLES_PER_ACTION} variables`);
    if (keys.some((key) => !/^[A-Za-z][A-Za-z0-9_.-]{0,79}$/u.test(key))) {
      errors.push('variable names must be stable alphanumeric codes');
    }
  }

  if (action === 'record_control_event') {
    const eventAction = typeof config['eventAction'] === 'string' ? config['eventAction'].trim() : '';
    if (!CONTROL_EVENT_PATTERN.test(eventAction)) {
      errors.push('eventAction must be a stable code between 3 and 80 characters');
    }
  }

  return { valid: errors.length === 0, action, errors };
}
