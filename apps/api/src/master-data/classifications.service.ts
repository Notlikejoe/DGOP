import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { BaseCrudService } from './base-crud.service';

@Injectable()
export class ClassificationsService extends BaseCrudService {
  constructor(prisma: PrismaService, audit: AuditService) {
    super(prisma, audit, {
      model: 'classification',
      entityType: 'classification',
      orderBy: { rank: 'asc' },
      deleteDependencies: [
        { model: 'dataAsset', field: 'classificationId', label: 'data assets', where: { deletedAt: null } },
        { model: 'maskingPolicy', field: 'classificationId', label: 'masking policies' },
        { model: 'roleDataAccessMap', field: 'maxClassificationId', label: 'data access maps' },
        { model: 'accessReviewItem', field: 'classificationId', label: 'access review items' },
        { model: 'dlpIncident', field: 'classificationId', label: 'DLP incidents' },
      ],
    });
  }
}
