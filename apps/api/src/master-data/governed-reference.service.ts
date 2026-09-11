import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AI_REFERENCE_ALIASES } from './ai-reference.catalog';

// Shared reference ownership. Publication/approval commands arrive with the
// permission and audit layer in Phase 1B; this foundation has no write endpoint.
@Injectable()
export class GovernedReferenceService {
  constructor(private readonly prisma: PrismaService) {}

  async activeVersion(listCode: string, at = new Date()) {
    if (!Number.isFinite(at.getTime())) throw new Error('Invalid reference effective date');
    const version = await this.prisma.governedReferenceVersion.findFirst({
      where: { listCode: AI_REFERENCE_ALIASES[listCode] ?? listCode, state: 'published', effectiveFrom: { lte: at },
        OR: [{ effectiveTo: null }, { effectiveTo: { gt: at } }] },
      include: { values: { orderBy: [{ sortOrder: 'asc' }, { code: 'asc' }] } },
    });
    if (!version) throw new Error(`No published reference version for ${listCode}`);
    if (listCode === 'L_FUNCTIONS') {
      version.values = version.values.filter(v=>typeof v.metadata==='object' && v.metadata!==null && !Array.isArray(v.metadata) && v.metadata.adoptionFunction===true);
      if (!version.values.length) throw new Error('Adoption department subset has not been mapped');
    }
    return version;
  }

  async historicalVersion(id: string) {
    const version = await this.prisma.governedReferenceVersion.findUnique({
      where: { id }, include: { values: { orderBy: [{ sortOrder: 'asc' }, { code: 'asc' }] } },
    });
    if (!version || version.state === 'draft') throw new Error('Published reference history not found');
    return version;
  }
}
