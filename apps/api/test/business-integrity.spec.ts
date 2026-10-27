import "reflect-metadata";
import assert from "node:assert/strict";
import { validate } from "class-validator";
import { ArchitectureReviewDecision } from "@prisma/client";
import { DecideArchitectureReviewDto } from "../src/extended-domains/extended-domains.dto";
import {
  BusinessRegisterQueryDto,
  MeasureValuationDto,
} from "../src/business-value/business-value.dto";
import { valuationOutcomeStatus } from "../src/business-value/business-value.logic";
import { presentBusinessLabels } from "../src/common/sample-labels.interceptor";
import { governanceDecisionProof } from "../src/common/governance-decision-proof";

(async () => {
  assert.equal(valuationOutcomeStatus(100000), "planned");
  assert.equal(valuationOutcomeStatus(100000, null), "planned");
  assert.equal(valuationOutcomeStatus(100000, 0), "at_risk");
  assert.equal(valuationOutcomeStatus(100000, 75000), "measuring");
  assert.equal(valuationOutcomeStatus(100000, 100000), "realized");
  assert.equal(valuationOutcomeStatus(0, 100), "realized");
  assert(
    (
      await validate(
        Object.assign(new DecideArchitectureReviewDto(), {
          decision: ArchitectureReviewDecision.approved,
        }),
      )
    ).some((v) => v.property === "expectedVersion"),
  );
  assert.equal(
    (
      await validate(
        Object.assign(new DecideArchitectureReviewDto(), {
          decision: ArchitectureReviewDecision.approved,
          expectedVersion: 1,
          workflowTaskId:"current-task",
        }),
      )
    ).length,
    0,
  );
  assert(
    (
      await validate(
        Object.assign(new BusinessRegisterQueryDto(), {
          page: 1,
          pageSize: 201,
        }),
      )
    ).length,
  );
  assert(
    (
      await validate(
        Object.assign(new BusinessRegisterQueryDto(), {
          search: "x".repeat(201),
        }),
      )
    ).length,
  );
  assert.equal(
    (
      await validate(
        Object.assign(new BusinessRegisterQueryDto(), {
          page: 9,
          pageSize: 25,
          search: "payroll",
        }),
      )
    ).length,
    0,
  );
  assert(
    (
      await validate(
        Object.assign(new MeasureValuationDto(), {
          expectedVersion: 1,
          actualAnnualValue: -1,
          measuredAt: "2026-01-01",
          evidenceId: "proof",
          evidenceJustification: "Valid relevance explanation",
        }),
      )
    ).length,
  );
  await assert.rejects(
    () =>
      governanceDecisionProof(
        {} as never,
        undefined,
        { id: "reviewer", email: "reviewer@example.test", roles: [] },
        { targetType: "architecture_review", targetId: "review", context: {} },
      ),
    /approved evidence document/,
  );
  const original = {
    decisionProof: { document: { title: "DEMO — original" }, digest: "abc" },
    verificationProof: { title: "DEMO — qualification" },
    realizationProof: { title: "DEMO — outcome" },
  };
  assert.deepEqual(presentBusinessLabels(original), original);
  console.log(
    "PASS forecast versus actual outcomes, required concurrency versions, bounded register contracts, evidence prerequisites and untouched proof snapshots",
  );
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
