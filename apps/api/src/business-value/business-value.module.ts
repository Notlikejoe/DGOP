import { Module } from '@nestjs/common';
import { AccessModule } from '../access/access.module';
import { WorkflowModule } from '../workflow/workflow.module';
import { BusinessValueController } from './business-value.controller';
import { BusinessValueService } from './business-value.service';

@Module({
  imports: [AccessModule, WorkflowModule],
  controllers: [BusinessValueController],
  providers: [BusinessValueService],
})
export class BusinessValueModule {}
