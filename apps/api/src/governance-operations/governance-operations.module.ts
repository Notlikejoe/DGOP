import { Module } from '@nestjs/common';
import { AiGovernanceModule } from '../ai-governance/ai-governance.module';
import { AccessModule } from '../access/access.module';
import { WorkflowModule } from '../workflow/workflow.module';
import { GovernanceOperationsController } from './governance-operations.controller';
import { GovernanceOperationsService } from './governance-operations.service';

@Module({
  imports: [AccessModule, WorkflowModule, AiGovernanceModule],
  controllers: [GovernanceOperationsController],
  providers: [GovernanceOperationsService],
})
export class GovernanceOperationsModule {}
