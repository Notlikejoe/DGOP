import { join } from 'node:path';
import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
import { PrismaModule } from './prisma/prisma.module';
import { HealthModule } from './health/health.module';
import { AuditModule } from './audit/audit.module';
import { AuthModule } from './auth/auth.module';
import { UsersModule } from './users/users.module';
import { RolesModule } from './roles/roles.module';
import { MasterDataModule } from './master-data/master-data.module';
import { AssetsModule } from './assets/assets.module';
import { OwnershipModule } from './ownership/ownership.module';
import { WorkflowModule } from './workflow/workflow.module';
import { NdiModule } from './ndi/ndi.module';
import { EvidenceModule } from './evidence/evidence.module';
import { ScoringModule } from './scoring/scoring.module';
import { DashboardModule } from './dashboard/dashboard.module';
import { TrainingModule } from './training/training.module';
import { DataQualityModule } from './data-quality/data-quality.module';
import { SecurityGovernanceModule } from './security-governance/security-governance.module';
import { IntegrationsModule } from './integrations/integrations.module';
import { OpenDataModule } from './open-data/open-data.module';
import { FoiModule } from './foi/foi.module';
import { PrivacyModule } from './privacy/privacy.module';
import { DataSharingModule } from './data-sharing/data-sharing.module';
import { SearchModule } from './search/search.module';
import { TransparencyModule } from './transparency/transparency.module';
import { ReportsModule } from './reports/reports.module';
import { AuditPacksModule } from './audit-packs/audit-packs.module';
import { ExtendedDomainsModule } from './extended-domains/extended-domains.module';
import { BusinessValueModule } from './business-value/business-value.module';
import { GovernanceOperationsModule } from './governance-operations/governance-operations.module';
import { GovernanceLifecycleModule } from './governance-lifecycle/governance-lifecycle.module';
import { AccessModule } from './access/access.module';
import { JwtAuthGuard } from './auth/jwt-auth.guard';
import { CsrfGuard } from './auth/csrf.guard';
import { RolesGuard } from './auth/roles.guard';
import { PermissionsGuard } from './access/permissions.guard';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      // Single source of truth: the repo root .env (three levels up from dist or src).
      envFilePath: [
        join(__dirname, '..', '..', '..', '.env'),
        join(process.cwd(), '..', '..', '.env'),
      ],
    }),
    PrismaModule,
    AccessModule,
    AuditModule,
    AuthModule,
    UsersModule,
    RolesModule,
    MasterDataModule,
    AssetsModule,
    OwnershipModule,
    WorkflowModule,
    NdiModule,
    EvidenceModule,
    ScoringModule,
    DashboardModule,
    TrainingModule,
    DataQualityModule,
    SecurityGovernanceModule,
    IntegrationsModule,
    OpenDataModule,
    FoiModule,
    PrivacyModule,
    DataSharingModule,
    SearchModule,
    TransparencyModule,
    ReportsModule,
    AuditPacksModule,
    ExtendedDomainsModule,
    BusinessValueModule,
    GovernanceOperationsModule,
    GovernanceLifecycleModule,
    HealthModule,
  ],
  providers: [
    // Order matters: authenticate first, protect cookie writes, then authorize by role and permission.
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_GUARD, useClass: CsrfGuard },
    { provide: APP_GUARD, useClass: RolesGuard },
    { provide: APP_GUARD, useClass: PermissionsGuard },
  ],
})
export class AppModule {}
