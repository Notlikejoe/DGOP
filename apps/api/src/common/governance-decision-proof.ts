import { BadRequestException, ForbiddenException } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { AuthUser } from "../auth/auth.types";
import {
  businessAuthoritySnapshot,
  businessDecisionRoles,
  liveRoleWhere,
} from "../auth/business-roles";
import { EvidenceService } from "../evidence/evidence.service";
import { lockVerifiedEvidence } from "../ai-governance/ai-evidence-proof";
import { proofDigest } from "../ai-governance/ai-evidence.logic";

/** Retain actual grant/scope roles; never substitute an unrestricted canonical role. */
export async function governanceDecisionActor(
  tx: Prisma.TransactionClient,
  email: string,
  permission: string,
): Promise<AuthUser> {
  const user = await tx.user.findFirst({
    where: { email, isActive: true },
    include: {
      userRoles: { where: { role: liveRoleWhere() }, include: { role: true } },
    },
  });
  if (!user)
    throw new ForbiddenException(
      "A current identifiable business actor is required",
    );
  const roles = await businessDecisionRoles(
    tx,
    user.userRoles.map((r) => r.role.code),
    permission,
  );
  return { id: user.id, email: user.email, roles };
}

/** The explicit subject link, original bytes and independently approved revision are pinned to the required audit. */
export async function governanceDecisionProof(
  tx: Prisma.TransactionClient,
  evidenceService: EvidenceService | undefined,
  actor: AuthUser,
  input: {
    evidenceId?: string | null;
    justification?: string;
    targetType: string;
    targetId: string;
    context: Record<string, unknown>;
  },
) {
  if (
    !input.evidenceId ||
    !input.justification?.trim() ||
    input.justification.trim().length < 10
  ) {
    throw new BadRequestException(
      "A current approved evidence document and an explicit relevance explanation are required",
    );
  }
  if (!evidenceService)
    throw new BadRequestException("Evidence verification is unavailable");
  await evidenceService.get(input.evidenceId, actor);
  const [row] = await lockVerifiedEvidence(tx, [input.evidenceId]);
  const authority = await businessAuthoritySnapshot(tx, actor.roles, null);
  const snapshot = {
    policyVersion: 1,
    targetType: input.targetType,
    targetId: input.targetId,
    actorId: actor.id,
    evaluatedAt: new Date().toISOString(),
    explicitRelevance: input.justification.trim(),
    context: input.context,
    ...authority,
    demoOnly: row.provenance !== "operational",
    operationalComplianceCredit: false,
    document: {
      id: row.id,
      title: row.title,
      sha256: row.sha256,
      sizeBytes: row.sizeBytes,
      provenance: row.provenance,
      evidenceUpdatedAt: row.updatedAt.toISOString(),
      reviewedBy: row.reviewedBy,
      reviewedAt: row.reviewedAt?.toISOString(),
      expiryDate: row.expiryDate?.toISOString() ?? null,
      uploadAuditId: row.uploadAuditId,
      uploadAuditHash: row.uploadAuditHash,
      approvalAuditId: row.approvalAuditId,
      approvalAuditHash: row.approvalAuditHash,
    },
  };
  return { ...snapshot, digest: proofDigest(snapshot) };
}
