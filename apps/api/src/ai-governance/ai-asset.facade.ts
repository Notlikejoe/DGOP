import { BadRequestException, ConflictException, ForbiddenException, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { ScopeService } from '../access/scope.service';
import { validateAssetCrossFields, validateAssetText, validateAssetTypeFields } from '../assets/assets.logic';
import { ProposeAiRegistrationDto } from './ai-registration.dto';

export type AiAssetContext = { id: string; useCaseRef: string; organizationUnitId: string; ownerName: string; ownerPersonId: string };

/** Monolith ACL: reuse DGOP asset validators/scopes; all writes join the caller's transaction. */
@Injectable()
export class AiAssetFacade {
  constructor(private readonly scope: ScopeService) {}

  async validate(tx: Prisma.TransactionClient, roles: string[], proposal: ProposeAiRegistrationDto, context: AiAssetContext) {
    const [classification, domain, org, scope] = await Promise.all([
      tx.classification.findFirst({ where: { id: proposal.classificationId, isActive: true, deletedAt: null } }),
      tx.dataDomain.findFirst({ where: { id: proposal.domainId, isActive: true, deletedAt: null } }),
      tx.organizationUnit.findFirst({ where: { id: context.organizationUnitId, isActive: true, deletedAt: null } }),
      this.scope.resolve(roles),
    ]);
    if (!classification || !domain || !org) throw new BadRequestException('Active asset classification, domain and owning department are required');
    if ((scope.orgUnits !== 'all' && !scope.orgUnits.includes(org.id))
      || (scope.domains !== 'all' && !scope.domains.includes(domain.id))
      || (scope.maxClassRank !== null && classification.rank > scope.maxClassRank)) {
      throw new ForbiddenException('AI asset registration is outside the actor data scope');
    }
    if (proposal.mode === 'link') {
      if (!proposal.existingAssetId || proposal.nameEn || proposal.nameAr || proposal.assetSubtype) {
        throw new BadRequestException('Link mode requires only an existing asset and its current domain/classification');
      }
      const asset = await tx.dataAsset.findFirst({ where: { id: proposal.existingAssetId, deletedAt: null, isActive: true } });
      if (!asset || asset.assetType !== 'ai_data_product' || ['deprecated', 'retired'].includes(asset.v6LifecycleState)
        || ['deprecated', 'retired'].includes(asset.lifecycleStatus) || asset.orgUnitId !== org.id
        || asset.domainId !== domain.id || asset.classificationId !== classification.id) {
        throw new BadRequestException('Link an active AI Data Product with the same owning department, domain and classification');
      }
      const metadata = this.metadata(asset.typeMetadataJson);
      const owners = await tx.stewardshipAssignment.findMany({ where: {
        targetType: 'asset', targetId: asset.id, isPrimary: true, isActive: true, deletedAt: null, approvalStatus: 'approved',
        effectiveDate: { lte: new Date() }, OR: [{ expiryDate: null }, { expiryDate: { gt: new Date() } }],
        roleType: { is: { code: 'data_owner', isActive: true, deletedAt: null } },
      }, select: { personId: true } });
      if (owners.length !== 1 || owners[0].personId !== context.ownerPersonId) throw new ForbiddenException('The nominated approver must be the existing asset primary approved Data Owner');
      if (metadata['aiUseCaseRef'] && metadata['aiUseCaseRef'] !== context.useCaseRef
        || await tx.aiUseCase.count({ where: { assetId: asset.id, useCaseRef: { not: context.useCaseRef } } })) {
        throw new ConflictException('The asset is already linked to another AI use-case identity');
      }
      return asset;
    }
    if (proposal.existingAssetId || !proposal.nameEn?.trim() || !proposal.nameAr?.trim() || !proposal.assetSubtype) {
      throw new BadRequestException('Create mode requires both asset names and an AI product subtype');
    }
    const errors = [
      ...validateAssetText({ code: `AST-${context.useCaseRef}`, nameEn: proposal.nameEn.trim(), nameAr: proposal.nameAr.trim() }, { requireCode: true, requireNames: true, allowCode: true }),
      ...validateAssetTypeFields({ assetType: 'ai_data_product', assetSubtype: proposal.assetSubtype }),
      ...validateAssetCrossFields({ subjectIds: [], classification, orgUnitId: org.id }),
    ];
    if (errors.length) throw new BadRequestException(errors.join('; '));
    if (await tx.dataAsset.findUnique({ where: { code: `AST-${context.useCaseRef}` } })) {
      throw new ConflictException('The generated AI asset code exists; select the governed link path');
    }
    return null;
  }

  async register(tx: Prisma.TransactionClient, roles: string[], proposal: ProposeAiRegistrationDto, context: AiAssetContext) {
    const existing = await this.validate(tx, roles, proposal, context);
    if (existing) return tx.dataAsset.update({ where: { id: existing.id }, data: {
      typeMetadataJson: { ...this.metadata(existing.typeMetadataJson), aiUseCaseRef: context.useCaseRef } as Prisma.InputJsonObject,
    } });
    return tx.dataAsset.create({ data: {
      code: `AST-${context.useCaseRef}`, nameEn: proposal.nameEn!.trim(), nameAr: proposal.nameAr!.trim(),
      assetType: 'ai_data_product', assetSubtype: proposal.assetSubtype, orgUnitId: context.organizationUnitId,
      domainId: proposal.domainId, classificationId: proposal.classificationId,
      ownerName: context.ownerName, ownerStatus: 'assigned', lifecycleStatus: 'draft',
      v6LifecycleState: 'registered', lifecyclePhase: 'discover',
      typeMetadataJson: { aiUseCaseRef: context.useCaseRef },
    } });
  }

  private metadata(value: unknown): Record<string, unknown> {
    return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
  }
}
