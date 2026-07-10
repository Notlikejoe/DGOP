import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { AuditModule } from '../audit/audit.module';
import { AccessModule } from '../access/access.module';
import { SecurityGovernanceController } from './security-governance.controller';
import { SecurityGovernanceService } from './security-governance.service';

@Module({
  imports: [PrismaModule, AuditModule, AccessModule],
  controllers: [SecurityGovernanceController],
  providers: [SecurityGovernanceService],
  exports: [SecurityGovernanceService],
})
export class SecurityGovernanceModule {}

