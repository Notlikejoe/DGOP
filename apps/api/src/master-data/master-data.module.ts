import { Module } from '@nestjs/common';
import { AiGovernanceModule } from '../ai-governance/ai-governance.module';
import { AiReferenceController } from './ai-reference.controller';
import { AiReferencePublicationService } from './ai-reference-publication.service';
import { GovernedReferenceService } from './governed-reference.service';
import { OrganizationUnitsController } from './organization-units.controller';
import { OrganizationUnitsService } from './organization-units.service';
import { SystemsController } from './systems.controller';
import { SystemsService } from './systems.service';
import { ClassificationsController } from './classifications.controller';
import { ClassificationsService } from './classifications.service';
import { RoleTypesController } from './role-types.controller';
import { RoleTypesService } from './role-types.service';
import { RaciTemplatesController } from './raci-templates.controller';
import { RaciTemplatesService } from './raci-templates.service';
import { DataDomainsController } from './data-domains.controller';
import { DataDomainsService } from './data-domains.service';
import { DataSubjectsController } from './data-subjects.controller';
import { DataSubjectsService } from './data-subjects.service';
import { BusinessCapabilitiesController } from './business-capabilities.controller';
import { BusinessCapabilitiesService } from './business-capabilities.service';
import { StatusValuesController } from './status-values.controller';
import { StatusValuesService } from './status-values.service';

@Module({
  imports: [AiGovernanceModule],
  controllers: [
    AiReferenceController,
    OrganizationUnitsController,
    SystemsController,
    ClassificationsController,
    RoleTypesController,
    RaciTemplatesController,
    DataDomainsController,
    DataSubjectsController,
    BusinessCapabilitiesController,
    StatusValuesController,
  ],
  providers: [
    AiReferencePublicationService,
    GovernedReferenceService,
    OrganizationUnitsService,
    SystemsService,
    ClassificationsService,
    RoleTypesService,
    RaciTemplatesService,
    DataDomainsService,
    DataSubjectsService,
    BusinessCapabilitiesService,
    StatusValuesService,
  ],
  exports: [GovernedReferenceService],
})
export class MasterDataModule {}
