# DGOP Audit Event Catalog - Sprint 46/47

This catalog covers the workflow, asset import, and access-grant events hardened for the production pilot.

| Event | Entity | Required Metadata |
| --- | --- | --- |
| `workflow_template.create` | `workflow_template` | `code`, `caseType` |
| `workflow_template.bpmn_draft.save` | `workflow_template` | `status`, `errors`, `warnings` |
| `workflow_template.bpmn.publish` | `workflow_template` | `version`, `stageCount`, `transitionCount` |
| `workflow_case.create` | `workflow_case` | `code`, `templateId` |
| `workflow_case.submit` | `workflow_case` | `fromStatus`, `toStatus` |
| `workflow_task.form.submit` | `workflow_task` | `stageCode`, `validatedFields`, `attachmentFields`, `previousSubmittedAt`, `newSubmittedAt` |
| `workflow_task.approved` | `workflow_task` | `decision`, `stageCode`, `routeTransitionId` |
| `workflow_task.rejected` | `workflow_task` | `decision`, `stageCode`, `routeTransitionId` |
| `workflow_task.return_for_clarification` | `workflow_task` | `commentRequired` |
| `data_asset.import` | `data_asset` | `created`, `updated`, `errors`, `previewErrors` |
| `access_grant.requested` | `access_grant` | `assetId`, `assetType`, `permissionCode`, `profileId`, `principalType`, `principalId` |
| `access_grant.owner_approved` | `access_grant` | `previousStatus`, `newStatus`, `previousOwnerDecision`, `newOwnerDecision` |
| `access_grant.owner_rejected` | `access_grant` | `previousStatus`, `newStatus`, `previousOwnerDecision`, `newOwnerDecision` |
| `access_grant.enforcement_update` | `access_grant` | `previousEnforcementStatus`, `newEnforcementStatus` |
| `access_grant.revoked` | `access_grant` | `previousStatus`, `previousEnforcementStatus`, `reason` |

All events must include `actor`, `entityType`, optional `entityId`, sanitized metadata, hash-chain fields, and `createdAt` through `AuditService`.
