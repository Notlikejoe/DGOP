import { Module } from '@nestjs/common';
import { AccessModule } from '../access/access.module';
import { OwnershipModule } from '../ownership/ownership.module';
import { WorkflowController } from './workflow.controller';
import { WorkflowService } from './workflow.service';

@Module({
  imports: [AccessModule, OwnershipModule],
  controllers: [WorkflowController],
  providers: [WorkflowService],
})
export class WorkflowModule {}
