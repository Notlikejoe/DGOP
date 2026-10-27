import "reflect-metadata";
import assert from "node:assert/strict";
import { readFileSync, writeFileSync } from "node:fs";
import { join, resolve, sep } from "node:path";
import { NestFactory } from "@nestjs/core";
import { AppModule } from "../src/app.module";
import { PrismaService } from "../src/prisma/prisma.service";
import { AuditService } from "../src/audit/audit.service";
import { EvidenceService } from "../src/evidence/evidence.service";
import { ExtendedDomainsService } from "../src/extended-domains/extended-domains.service";
import { BusinessValueService } from "../src/business-value/business-value.service";
import { WorkflowService } from "../src/workflow/workflow.service";
import { TrainingService } from "../src/training/training.service";
import { AuthUser } from "../src/auth/auth.types";
import { ArchitectureReviewDecision, Prisma } from "@prisma/client";
import { lockVerifiedEvidence } from "../src/ai-governance/ai-evidence-proof";

const url = new URL(process.env.DATABASE_URL ?? "");
assert(
  process.env.NODE_ENV === "test" &&
    /^\/dgop_ai_test_(?:seven|five)_\d+$/.test(url.pathname) &&
    url.hostname === "127.0.0.1" &&
    url.port === "55436",
);
assert.equal(process.env.DGOP_SEVEN_FIX_ALLOW_MUTATIONS, "true");
const report: {
  startedAt: string;
  finishedAt?: string;
  passed: boolean;
  database: string;
  checks: { name: string; passed: boolean; detail?: unknown }[];
  error?: string;
} = {
  startedAt: new Date().toISOString(),
  passed: false,
  database: url.pathname.slice(1),
  checks: [],
};
async function main() {
  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: false,
  });
  try {
    const db = app.get(PrismaService),
      audit = app.get(AuditService),
      evidence = app.get(EvidenceService),
      arch = app.get(ExtendedDomainsService),
      value = app.get(BusinessValueService),
      training = app.get(TrainingService);
    const fixtures = JSON.parse(
      readFileSync(process.env.DGOP_SEVEN_FIX_MANIFEST!, "utf8"),
    );
    const actor = async (email: string): Promise<AuthUser> => {
      const user = await db.user.findUniqueOrThrow({
        where: { email },
        include: { userRoles: { include: { role: true } } },
      });
      return {
        id: user.id,
        email: user.email,
        roles: user.userRoles.map((v) => v.role.code),
        businessRoles: user.userRoles
          .filter((v) => v.role.businessRoleCode)
          .map((v) => ({
            roleCode: v.role.code,
            businessRoleCode: v.role.businessRoleCode!,
          })),
      };
    };
    const admin = await actor("qa.admin@dgop.local"),
      creator = await actor("demo.steward@dgop.local"),
      fin = await actor("demo.fin.data-owner@dgop.local"),
      hr = await actor("demo.hr.data-owner@dgop.local"),
      ndi = await actor("demo.fin.evidence-reviewer@dgop.local");
    const useCase = await db.aiUseCase.findUniqueOrThrow({
        where: {
          id: fixtures.ai.cases.find((v: any) => v.scope === "finance")
            .useCaseId,
        },
      }),
      assetId = useCase.assetId!;
    const workflow=app.get(WorkflowService),technical=await actor('demo.mlops@dgop.local'),controls=await actor('demo.fin.steward@dgop.local');
    async function advanceArchitecture(id:string){
      for(let i=0;i<8;i++){
        const review=await db.architectureReview.findUniqueOrThrow({where:{id}}),task=await db.workflowTask.findFirst({where:{caseId:review.workflowCaseId!,status:{in:['pending','in_progress']}},include:{templateStage:true},orderBy:{createdAt:'asc'}});
        assert(task,'The native review route must have an active task');if(task.templateStage?.isDecision)return task.id;
        const assigned=task.assigneeUserId?await db.user.findUniqueOrThrow({where:{id:task.assigneeUserId},select:{email:true}}):null;
        const reviewer=assigned?await actor(assigned.email):task.assigneeRoleCode==='technical_steward'?technical:controls;
        assert(!reviewer.roles.includes('system_admin'),'Review stages must use their actual non-admin assignees');
        await workflow.decideTask(task.id,{decision:'approved',comment:'Independent native impact/control review for isolated integration acceptance'},reviewer);
      }throw Error('Architecture route did not reach its decision stage');
    }
    async function createPreparedReview(...args:Parameters<ExtendedDomainsService['createArchitectureReview']>){const row=await arch.createArchitectureReview(...args);await advanceArchitecture(row.id);return row;}
    async function decide(roles:string[],id:string,input:any,email:string){
      const review=await db.architectureReview.findUniqueOrThrow({where:{id}}),task=await db.workflowTask.findFirst({where:{caseId:review.workflowCaseId!,status:{in:['pending','in_progress']},templateStage:{isDecision:true}}});
      return arch.decideArchitectureReview(roles,id,{...input,workflowTaskId:input.workflowTaskId??task?.id??'stale-decision-task',...(['needs_changes','rejected'].includes(input.decision)&&!input.decisionReason?{decisionReason:'Independent reviewed decision in the isolated integration test'}:{})},email);
    }
    const originalDoc = await db.ndiEvidence.findUniqueOrThrow({
      where: { id: fixtures.items["proof.finance"].id },
    });
    const check = async (name: string, fn: () => Promise<unknown>) => {
      const detail = await fn();
      report.checks.push({ name, passed: true, detail });
      console.log(JSON.stringify({ name, passed: true }));
    };
    const rejects = (fn: () => Promise<unknown>, status: number) =>
      assert.rejects(fn, (error: any) => error.getStatus?.() === status);
    const document = async (title: string) => {
      const buffer = Buffer.from(
        JSON.stringify({
          synthetic: true,
          title,
          assetId,
          subject: fin.id,
          statement:
            "Fictional approval and qualification supporting document for isolated functional tests. No operational compliance credit.",
        }),
      );
      const row = await evidence.create(
        {
          specId: originalDoc.specId,
          title,
          submit: "true",
          expiryDate: new Date(Date.now() + 86400000 * 30).toISOString(),
        },
        {
          buffer,
          size: buffer.length,
          mimetype: "text/plain",
          originalname: "synthetic-proof.txt",
        },
        admin,
      );
      await evidence.review(
        row.id,
        {
          decision: "approve",
          comment:
            "Independently reviewed synthetic supporting content and its context.",
        },
        ndi,
      );
      return db.ndiEvidence.findUniqueOrThrow({ where: { id: row.id } });
    };
    const proof = await document(
      "SYNTHETIC — architecture, qualification and measured-outcome test proof",
    );
    const createReview = () =>
      createPreparedReview(
        creator.roles,
        { assetId, title: "SYNTHETIC — independent architecture review" },
        creator.email,
      );
    const link = async (id: string) => {
      const row = await db.architectureReview.findUniqueOrThrow({
        where: { id },
      });
      return decide(
        admin.roles,
        id,
        {
          decision: ArchitectureReviewDecision.pending,
          expectedVersion: row.version,
          evidenceId: proof.id,
          evidenceJustification:
            "This verified document supports the named asset and this exact architecture review.",
        },
        admin.email,
      );
    };
    const review = await createReview();
    await check(
      "Architecture denies missing proof, creator approval and stale versions",
      async () => {
        await rejects(
          () =>
            decide(
              admin.roles,
              review.id,
              {
                decision: ArchitectureReviewDecision.approved,
                expectedVersion: 1,
              },
              admin.email,
            ),
          400,
        );
        await rejects(
          () =>
            decide(
              creator.roles,
              review.id,
              {
                decision: ArchitectureReviewDecision.approved,
                expectedVersion: 1,
              },
              creator.email,
            ),
          403,
        );
        await rejects(
          () =>
            decide(
              admin.roles,
              review.id,
              {
                decision: ArchitectureReviewDecision.rejected,
                expectedVersion: 99,
              },
              admin.email,
            ),
          409,
        );
      },
    );
    await check(
      "Architecture requires an explicit current link to the exact review",
      async () => {
        await rejects(
          () =>
            decide(
              admin.roles,
              review.id,
              {
                decision: ArchitectureReviewDecision.approved,
                expectedVersion: 1,
                evidenceId: proof.id,
                evidenceJustification:
                  "Unlinked document must not become approval evidence.",
              },
              admin.email,
            ),
          409,
        );
        await link(review.id);
        const other = await createReview();
        const row = await db.architectureReview.findUniqueOrThrow({
          where: { id: review.id },
        });
        // Fault injection is restricted to this disposable clone: a copied link must not bind another record.
        await db.architectureReview.update({
          where: { id: other.id },
          data: {
            decisionProof: row.decisionProof as Prisma.InputJsonValue,
            evidenceId: proof.id,
          },
        });
        await rejects(
          () =>
            decide(
              admin.roles,
              other.id,
              {
                decision: ArchitectureReviewDecision.approved,
                expectedVersion: 1,
                evidenceId: proof.id,
                evidenceJustification:
                  "A copied link belongs to another architecture review.",
              },
              admin.email,
            ),
          409,
        );
      },
    );
    const linked = await db.architectureReview.findUniqueOrThrow({
        where: { id: review.id },
      }),
      decision = {
        decision: ArchitectureReviewDecision.approved,
        expectedVersion: linked.version,
        evidenceId: proof.id,
        evidenceJustification:
          "This current approved proof supports the architecture decision for its registered asset.",
      };
    await check(
      "PostgreSQL required-audit failure rolls back the architecture decision",
      async () => {
        const original = audit.logRequired.bind(audit);
        audit.logRequired = async (entry, tx) => {
          if (entry.action === "extended_domains.architecture_review.decide")
            throw new Error("Injected required audit failure");
          return original(entry, tx);
        };
        try {
          await assert.rejects(
            () =>
              decide(
                admin.roles,
                review.id,
                decision,
                admin.email,
              ),
            /Injected required audit/,
          );
        } finally {
          audit.logRequired = original;
        }
        const after = await db.architectureReview.findUniqueOrThrow({
          where: { id: review.id },
        });
        assert.equal(after.decision, "pending");
        assert.equal(after.version, linked.version);
        assert.deepEqual(after.decisionProof, linked.decisionProof);
      },
    );
    await check(
      "Overlapping architecture decisions produce one durable result and one 409",
      async () => {
        const results = await Promise.allSettled([
          decide(
            admin.roles,
            review.id,
            decision,
            admin.email,
          ),
          decide(
            admin.roles,
            review.id,
            {
              ...decision,
              decision: ArchitectureReviewDecision.approved_with_conditions,
            },
            admin.email,
          ),
        ]);
        assert.equal(results.filter((v) => v.status === "fulfilled").length, 1);
        assert(
          results.some(
            (v) => v.status === "rejected" && v.reason.getStatus?.() === 409,
          ),
        );
        return { results: results.map((v) => v.status) };
      },
    );
    await check(
      "Final review cannot be overwritten; re-review is a new linked native record",
      async () => {
        const saved = await db.architectureReview.findUniqueOrThrow({
          where: { id: review.id },
        });
        await rejects(
          () =>
            decide(
              admin.roles,
              review.id,
              {
                decision: ArchitectureReviewDecision.rejected,
                expectedVersion: saved.version,
              },
              admin.email,
            ),
          409,
        );
        await assert.rejects(() =>
          db.architectureReview.update({
            where: { id: review.id },
            data: { title: "Forbidden rewrite" },
          }),
        );
        const revision = await arch.reviseArchitectureReview(
          creator.roles,
          review.id,
          creator.email,
        );
        assert.equal(revision.previousReviewId, review.id);
        assert.equal(revision.decision, "pending");
        assert.notEqual(revision.workflowCaseId, saved.workflowCaseId);
        const rejected = await createReview();
        await decide(
          admin.roles,
          rejected.id,
          { decision: ArchitectureReviewDecision.rejected, expectedVersion: 1 },
          admin.email,
        );
        const workspace = await arch.workspace(admin.roles, admin.email);
        assert.equal(
          workspace.architectureReviews.find((row) => row.id === review.id)
            ?.assurance,
          "verified",
        );
        assert.equal(
          workspace.architectureReviews.find((row) => row.id === rejected.id)
            ?.assurance,
          "recorded",
        );
      },
    );
    await check(
      "Unavailable bytes, expiry and native revocation reject proof",
      async () => {
        await assert.rejects(
          () =>
            db.$transaction((tx) =>
              lockVerifiedEvidence(
                tx,
                [proof.id],
                new Date(proof.expiryDate!.getTime() + 1),
              ),
            ),
          /expired/,
        );
        const file = resolve(process.env.EVIDENCE_STORAGE_DIR!, proof.fileName),
          root = resolve(process.env.EVIDENCE_STORAGE_DIR!);
        assert(file.startsWith(root + sep));
        const bytes = readFileSync(file);
        try {
          writeFileSync(file, Buffer.from("corrupt"));
          const row = await createReview();
          await rejects(
            () =>
              decide(
                admin.roles,
                row.id,
                {
                  decision: "pending",
                  expectedVersion: 1,
                  evidenceId: proof.id,
                  evidenceJustification:
                    "Changed original bytes must prevent a verified link.",
                },
                admin.email,
              ),
            400,
          );
        } finally {
          writeFileSync(file, bytes);
        }
        const revoked = await document("SYNTHETIC — revoked proof"),
          row = await createReview();
        await evidence.revoke(revoked.id, ndi);
        await rejects(
          () =>
            decide(
              admin.roles,
              row.id,
              {
                decision: "pending",
                expectedVersion: 1,
                evidenceId: revoked.id,
                evidenceJustification:
                  "Revoked supporting content must not become linked proof.",
              },
              admin.email,
            ),
          400,
        );
      },
    );
    const track = await db.certificationTrack.findFirstOrThrow({
      where: { deletedAt: null, isActive: true },
    });
    await check(
      "External pass needs proof, allows external scores, preserves assessor identity and legacy exclusions",
      async () => {
        await rejects(
          () =>
            training.createCertificationAttempt(
              {
                trackId: track.id,
                userId: fin.id,
                status: "passed",
                qualificationType: "external",
                examScore: 0,
              },
              admin.email,
            ),
          400,
        );
        await rejects(
          () =>
            training.createCertificationAttempt(
              {
                trackId: track.id,
                userId: admin.id,
                status: "passed",
                evidenceId: proof.id,
                evidenceJustification:
                  "Self qualification is not independently verified.",
              },
              admin.email,
            ),
          403,
        );
        const passed = await training.createCertificationAttempt(
          {
            trackId: track.id,
            userId: fin.id,
            status: "passed",
            qualificationType: "external",
            examScore: 0,
            evidenceId: proof.id,
            evidenceJustification:
              "The external certificate has been independently checked for this learner and track.",
            assessor: "not-the-actor",
          },
          admin.email,
        );
        assert.equal(passed.status, "passed");
        assert.equal(passed.assessor, admin.email);
        assert(passed.verificationProof);
        const legacy = await db.certificationAttempt.findFirst({
          where: {
            status: "passed",
            verificationProof: { equals: Prisma.DbNull },
          },
        });
        if (legacy) {
          const page = await training.listCertificationAttempts(admin, 1, 200);
          assert("data" in page);
          assert.equal(
            page.data.find((v) => v.id === legacy.id)?.state,
            "review_needed",
          );
        }
        await rejects(
          () =>
            training.createCertificationAttempt(
              {
                trackId: track.id,
                userId: fin.id,
                status: "passed",
                qualificationType: "internal",
                examScore: 0,
                evidenceId: proof.id,
                evidenceJustification:
                  "An internal exam still needs the configured passing grade.",
              },
              admin.email,
            ),
          400,
        );
      },
    );
    const course = await db.trainingCourse.findFirstOrThrow({
      where: { isActive: true, deletedAt: null },
    });
    let assignment = await db.trainingAssignment.findFirst({
      where: {
        userId: fin.id,
        courseId: course.id,
        status: { in: ["assigned", "in_progress"] },
      },
    });
    if (!assignment)
      assignment = await training.createAssignment(
        { courseId: course.id, userId: fin.id },
        admin.email,
      );
    await check(
      "Completion retries are idempotent; conflicting retries fail; audit failure rolls back",
      async () => {
        const original = audit.logRequired.bind(audit);
        audit.logRequired = async (entry, tx) => {
          if (entry.action === "training_assignment.complete")
            throw Error("Injected completion audit failure");
          return original(entry, tx);
        };
        try {
          await assert.rejects(
            () =>
              training.completeAssignment(assignment!.id, { score: 80 }, fin),
            /Injected completion audit/,
          );
        } finally {
          audit.logRequired = original;
        }
        assert(
          ["assigned", "in_progress"].includes(
            (
              await db.trainingAssignment.findUniqueOrThrow({
                where: { id: assignment!.id },
              })
            ).status,
          ),
        );
        const results = await Promise.all([
          training.completeAssignment(assignment!.id, { score: 80 }, fin),
          training.completeAssignment(assignment!.id, { score: 80 }, fin),
        ]);
        assert.equal(
          results[0].completedAt?.getTime(),
          results[1].completedAt?.getTime(),
        );
        await rejects(
          () => training.completeAssignment(assignment!.id, { score: 81 }, fin),
          409,
        );
      },
    );
    await check(
      "Expired history cannot renew itself; explicit renewal preserves the predecessor",
      async () => {
        // Deterministic time-lapse fault fixture in the disposable clone; no completion or audit is fabricated.
        const expired = await db.trainingAssignment.update({
          where: { id: assignment!.id },
          data: { status: "expired", expiresAt: new Date("2020-02-01") },
        });
        const replay = await training.completeAssignment(
          expired.id,
          { score: 80 },
          fin,
        );
        assert.equal(replay.expiresAt?.getTime(), expired.expiresAt?.getTime());
        const renewals = await Promise.all([
          training.renewAssignment(expired.id, admin.email),
          training.renewAssignment(expired.id, admin.email),
        ]);
        assert.equal(renewals[0].id, renewals[1].id);
        assert.equal(renewals[0].renewedFromId, expired.id);
        assert.equal(renewals[0].status, "assigned");
        assert.equal(
          (
            await db.trainingAssignment.findUniqueOrThrow({
              where: { id: expired.id },
            })
          ).expiresAt?.getTime(),
          expired.expiresAt?.getTime(),
        );
      },
    );
    const valuation = await value.createValuation(
      fin.roles,
      {
        assetId,
        useCase: "SYNTHETIC — forecast before measured outcome",
        annualValue: 1000,
      },
      fin.email,
    );
    await check(
      "Forecast remains planned; measured outcome needs proof and rejects stale writes",
      async () => {
        assert.equal(valuation.status, "planned");
        await rejects(
          () =>
            value.measureValuation(
              admin.roles,
              valuation.id,
              {
                expectedVersion: 1,
                actualAnnualValue: 1000,
                measuredAt: new Date().toISOString(),
                evidenceId: "",
                evidenceJustification:
                  "Missing proof must not realize a forecast.",
              },
              admin.email,
            ),
          400,
        );
        const measured = await value.measureValuation(
          admin.roles,
          valuation.id,
          {
            expectedVersion: 1,
            actualAnnualValue: 1000,
            measuredAt: new Date().toISOString(),
            evidenceId: proof.id,
            evidenceJustification:
              "Verified measured annual benefit supports this exact asset and valuation.",
          },
          admin.email,
        );
        assert.equal(measured.status, "realized");
        assert.equal(measured.actualAnnualValue, 1000);
        assert(measured.realizationProof);
        await rejects(
          () =>
            value.measureValuation(
              admin.roles,
              valuation.id,
              {
                expectedVersion: 1,
                actualAnnualValue: 0,
                measuredAt: new Date().toISOString(),
                evidenceId: proof.id,
                evidenceJustification:
                  "A stale measurement cannot overwrite the recorded outcome.",
              },
              admin.email,
            ),
          409,
        );
      },
    );
    await check(
      "201-row discovery, server search, complete aggregates and departmental isolation",
      async () => {
        const prefix = "Boundary " + Date.now() + " ";
        for (let index = 0; index < 201; index++)
          await value.createValuation(
            fin.roles,
            {
              assetId,
              useCase: prefix + String(index).padStart(3, "0"),
              annualValue: 100,
            },
            fin.email,
          );
        const first = await value.listRegister(
            "valuations",
            fin.roles,
            fin.email,
            { search: prefix, page: 1, pageSize: 25 },
          ),
          last = await value.listRegister("valuations", fin.roles, fin.email, {
            search: prefix,
            page: 9,
            pageSize: 25,
          }),
          found = await value.listRegister("valuations", fin.roles, fin.email, {
            search: prefix + "200",
            page: 1,
            pageSize: 25,
          });
        assert.equal(first.total, 201);
        assert.equal(first.data.length, 25);
        assert.equal(last.data.length, 1);
        assert.equal(found.total, 1);
        assert.equal(
          (
            await value.listRegister("valuations", hr.roles, hr.email, {
              search: prefix,
            })
          ).total,
          0,
        );
        const ids = new Set<string>();
        for (let page = 1; page <= 9; page++) {
          const part = await value.listRegister(
            "valuations",
            fin.roles,
            fin.email,
            { search: prefix, page, pageSize: 25 },
          );
          for (const row of part.data) {
            assert(
              !ids.has(row.id),
              "A tied sort repeated a record across pages",
            );
            ids.add(row.id);
          }
        }
        assert.equal(ids.size, 201);
        const workspace = await value.workspace(admin.roles, admin.email),
          totals = await db.dataAssetValuation.aggregate({
            _sum: { annualValue: true },
          });
        assert.equal(
          workspace.summary.totalAnnualValue,
          Math.round(totals._sum.annualValue ?? 0),
        );
        assert.equal(
          workspace.registerPages.valuations.total,
          await db.dataAssetValuation.count(),
        );
        return {
          matching: 201,
          pages: first.totalPages,
          lastPage: last.data.length,
          prefix,
        };
      },
    );
    const chain = await audit.verifyChain();
    assert(chain.valid);
    report.passed = true;
  } catch (error) {
    report.error = error instanceof Error ? error.stack : String(error);
    process.exitCode = 1;
  } finally {
    report.finishedAt = new Date().toISOString();
    writeFileSync(
      process.env.DGOP_SEVEN_FIX_RECEIPT!,
      JSON.stringify(report, null, 2),
    );
    await app.close();
    console.log(
      JSON.stringify({
        receipt: process.env.DGOP_SEVEN_FIX_RECEIPT,
        passed: report.passed,
        checks: report.checks.length,
        error: report.error,
      }),
    );
  }
}
void main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
