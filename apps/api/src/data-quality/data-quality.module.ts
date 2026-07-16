import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { AuditModule } from '../audit/audit.module';
import { AccessModule } from '../access/access.module';
import { WorkflowModule } from '../workflow/workflow.module';
import { DataQualityController } from './data-quality.controller';
import { DataQualityService } from './data-quality.service';

@Module({
  imports: [PrismaModule, AuditModule, AccessModule, WorkflowModule],
  controllers: [DataQualityController],
  providers: [DataQualityService],
  exports: [DataQualityService],
})
export class DataQualityModule {}
