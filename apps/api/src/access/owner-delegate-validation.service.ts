import { Injectable } from '@nestjs/common';
import { ApprovalStatus, AssignmentTargetType, WorkflowDelegationStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

const DATA_OWNER_CODE = 'data_owner';

export interface OwnerDelegateValidationInput {
  assetId: string;
  actorUserId?: string | null;
  actorEmail?: string | null;
  roleCode?: string | null;
  at?: Date;
}

export interface OwnerDelegateValidationResult {
  allowed: boolean;
  reason: string;
  ownerPersonId?: string | null;
  ownerUserId?: string | null;
  delegatedByUserId?: string | null;
  delegationId?: string | null;
}

@Injectable()
export class OwnerDelegateValidationService {
  constructor(private readonly prisma: PrismaService) {}

  async validateActiveOwnerOrDelegate(
    input: OwnerDelegateValidationInput,
  ): Promise<OwnerDelegateValidationResult> {
    const at = input.at ?? new Date();
    const roleCode = input.roleCode ?? DATA_OWNER_CODE;
    const actor = await this.resolveActor(input.actorUserId, input.actorEmail);
    if (!actor.userId && !actor.email) {
      return { allowed: false, reason: 'Actor identity is required for owner validation' };
    }

    const assignment = await this.prisma.stewardshipAssignment.findFirst({
      where: {
        targetType: AssignmentTargetType.asset,
        targetId: input.assetId,
        isActive: true,
        deletedAt: null,
        approvalStatus: ApprovalStatus.approved,
        effectiveDate: { lte: at },
        OR: [{ expiryDate: null }, { expiryDate: { gt: at } }],
        roleType: { code: roleCode, deletedAt: null, isActive: true },
      },
      include: {
        person: { select: { id: true, email: true, userId: true, isActive: true, deletedAt: true } },
      },
      orderBy: [{ isPrimary: 'desc' }, { updatedAt: 'desc' }],
    });
    if (!assignment || !assignment.person.isActive || assignment.person.deletedAt) {
      return { allowed: false, reason: `No active approved ${roleCode} assignment is registered for this asset` };
    }

    const ownerUserId = assignment.person.userId ?? null;
    const ownerEmail = assignment.person.email ?? null;
    const actorIsOwner =
      (!!ownerUserId && ownerUserId === actor.userId) ||
      (!!ownerEmail && !!actor.email && ownerEmail.toLowerCase() === actor.email.toLowerCase());
    if (actorIsOwner) {
      return {
        allowed: true,
        reason: 'Actor is the active asset owner',
        ownerPersonId: assignment.personId,
        ownerUserId,
      };
    }
    if (!ownerUserId || !actor.userId) {
      return {
        allowed: false,
        reason: 'Active owner has no linked user delegation path for this actor',
        ownerPersonId: assignment.personId,
        ownerUserId,
      };
    }

    const delegation = await this.prisma.workflowDelegation.findFirst({
      where: {
        delegatorUserId: ownerUserId,
        delegateUserId: actor.userId,
        roleCode,
        status: WorkflowDelegationStatus.active,
        startsAt: { lte: at },
        expiresAt: { gt: at },
        OR: [{ assetId: input.assetId }, { assetId: null }],
      },
      orderBy: [{ assetId: 'desc' }, { expiresAt: 'asc' }],
      select: { id: true, delegatorUserId: true },
    });
    if (!delegation) {
      return {
        allowed: false,
        reason: 'Actor is neither the active owner nor an approved delegate for this asset',
        ownerPersonId: assignment.personId,
        ownerUserId,
      };
    }
    return {
      allowed: true,
      reason: 'Actor is an approved active owner delegate',
      ownerPersonId: assignment.personId,
      ownerUserId,
      delegatedByUserId: delegation.delegatorUserId,
      delegationId: delegation.id,
    };
  }

  private async resolveActor(actorUserId?: string | null, actorEmail?: string | null) {
    if (actorUserId && actorEmail) return { userId: actorUserId, email: actorEmail };
    if (actorUserId) {
      const user = await this.prisma.user.findFirst({
        where: { id: actorUserId, isActive: true },
        select: { id: true, email: true },
      });
      return { userId: user?.id ?? actorUserId, email: user?.email ?? actorEmail ?? null };
    }
    if (actorEmail) {
      const user = await this.prisma.user.findFirst({
        where: { email: actorEmail, isActive: true },
        select: { id: true, email: true },
      });
      return { userId: user?.id ?? null, email: user?.email ?? actorEmail };
    }
    return { userId: null, email: null };
  }
}
