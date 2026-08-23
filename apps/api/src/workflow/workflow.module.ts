import { Module } from '@nestjs/common';
import { AccessModule } from '../access/access.module';
import { OwnershipModule } from '../ownership/ownership.module';
import { IntegrationsModule } from '../integrations/integrations.module';
import { WorkflowController } from './workflow.controller';
import { WorkflowService } from './workflow.service';

@Module({
  imports: [AccessModule, OwnershipModule, IntegrationsModule],
  controllers: [WorkflowController],
  providers: [WorkflowService],
  exports: [WorkflowService],
})
export class WorkflowModule {}
