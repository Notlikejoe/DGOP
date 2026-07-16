import { Module } from '@nestjs/common';
import { AccessModule } from '../access/access.module';
import { AuditModule } from '../audit/audit.module';
import { PrismaModule } from '../prisma/prisma.module';
import { WorkflowModule } from '../workflow/workflow.module';
import { DataSharingController } from './data-sharing.controller';
import { DataSharingService } from './data-sharing.service';

@Module({
  imports: [PrismaModule, AuditModule, AccessModule, WorkflowModule],
  controllers: [DataSharingController],
  providers: [DataSharingService],
})
export class DataSharingModule {}
