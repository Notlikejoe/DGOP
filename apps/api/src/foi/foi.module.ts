import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { AuditModule } from '../audit/audit.module';
import { AccessModule } from '../access/access.module';
import { WorkflowModule } from '../workflow/workflow.module';
import { FoiController } from './foi.controller';
import { FoiService } from './foi.service';

@Module({
  imports: [PrismaModule, AuditModule, AccessModule, WorkflowModule],
  controllers: [FoiController],
  providers: [FoiService],
  exports: [FoiService],
})
export class FoiModule {}
