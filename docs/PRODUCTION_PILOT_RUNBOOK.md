# DGOP v6 Production Pilot Runbook

## Purpose

This runbook governs promotion of the DGOP v6 production pilot. It is evidence-led: a readiness label is not a deployment approval, and each approval is retained as an append-only record in the platform.

## Pilot scope

- Workflow: BPMN XML validation, version diff and rollback, migration preview, isolated test instances, advanced node execution, SLA/timer/escalation evidence, and route/case visibility.
- Access management: request, owner decision, dispatch, verification, manual enforcement evidence, CSV validation/export, owner-delegate rules, campaigns, and audit history.
- Governance operations: production-readiness controls, acceptance dashboard, signed gates, deployment-rehearsal evidence, audit/control packs, operational notifications, and escalation routes.

## Preflight

1. Confirm the deployed API reports healthy at `GET /api/health` and the web application loads through its configured origin.
2. Apply and verify migrations:

   ```powershell
   cd apps/api
   npm run prisma:deploy
   npx prisma migrate status
   ```

3. Run the API test suite and production builds for API and web.
4. Confirm the signed-in pilot operator has `governance_operations.run` plus one of: `system_admin`, `dmo_admin`, `security_admin`, or `executive_sponsor`.
5. Capture environment, release identifier, migration output, build identifiers, and test results in the pilot evidence store.

## Workflow UAT Gate

1. Open `Governance > Workflow` and choose each preloaded route in turn.
2. Open the advanced BPMN canvas, then verify import/export, XML validation, version diff, migration preview, and rollback controls for one non-production definition.
3. Start an isolated test instance. Complete a user task, an approval, and at least one automated/timer or escalation path.
4. Verify that the case timeline, assignment, notifications, SLA state, and audit trail agree with the rendered route.
5. Record the outcome under **Workflow Canvas UAT**. A blocked workflow readiness signal must be declined or approved with a signed exception; it cannot receive a clean approval.

## Access Management UAT Gate

1. Open `Governance > Access Management` and submit an access request for an allowed asset and principal.
2. Complete the owner approval or rejection path and verify the decision/audit history.
3. Dispatch the approved grant, then verify the connector outcome or capture manual-provisioning evidence and reference.
4. Validate a CSV before import; only import a validated file. Export the outcome/audit evidence.
5. Record the outcome under **Access Management UAT**. Treat a failed or unverified enforcement as a block unless an explicit exception is accepted.

## Security and Integration Gate

1. Confirm security-control evidence, audit-chain integrity, and open-risk count from `Governance > Governance Operations`.
2. Validate configured enterprise integrations in the target environment: SSO/identity provider, SIEM ingestion, Vault or secret manager, and search backend/fallback. Do not represent an unconfigured local integration as production evidence.
3. Capture endpoint/configuration identifiers and test evidence without recording credentials in DGOP.
4. Record the result under **Security and control evidence**.

## Performance and Reliability Gate

1. Measure the target environment against the approved pilot profile: workflow concurrent load, access request/approval load, asset search/listing load, and asynchronous retry behavior.
2. Record the workload, duration, success/error counts, latency percentiles, database saturation signals, and any accepted constraints.
3. Register non-blocking deviations as explicit mitigated exceptions; decline the gate for unmitigated reliability risk.
4. Record the result under **Performance evidence and exceptions**.

## Deployment Rehearsal

1. Create a rehearsal record in `Governance > Governance Operations` before the rehearsal begins.
2. Deploy the exact migration/build package planned for promotion into a non-production environment.
3. Perform health, authentication, workflow, access-enforcement, and audit-log smoke checks.
4. Execute and document a rollback drill. A rehearsal may only be marked **Passed** when rollback was tested and its completion time is recorded.
5. Attach non-sensitive links/references to the deployment, verification, and rollback evidence.

## Go/No-Go

1. Review the production acceptance dashboard, the five signed gates, latest rehearsal, open critical issues, and accepted exceptions.
2. The accountable approver records the **Production pilot go/no-go** decision in the platform.
3. Promote only when the decision is approved, no control is blocked without a signed exception, and the deployment rehearsal passed with rollback evidence.
4. On a no-go, preserve the evidence, create remediation work, and schedule a new rehearsal. Never overwrite or delete a sign-off record.

## Rollback and Hypercare

1. Stop further promotion, switch traffic or deployment to the last verified release, and run API health and essential workflow/access smoke checks.
2. Preserve logs, audit records, connector outcomes, and incident timeline; do not purge evidence during recovery.
3. Notify the operating body through the approved escalation channel and log the root-cause/remediation owner.
4. During hypercare, review failed workflow automations, SLA breaches, access-enforcement failures, notifications, and integration errors daily. Record closure evidence before closing the pilot acceptance package.
