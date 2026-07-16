import { Module } from '@nestjs/common';
import { AccessModule } from '../access/access.module';
import { WorkflowModule } from '../workflow/workflow.module';
import { ExtendedDomainsController } from './extended-domains.controller';
import { ExtendedDomainsService } from './extended-domains.service';

@Module({
  imports: [AccessModule, WorkflowModule],
  controllers: [ExtendedDomainsController],
  providers: [ExtendedDomainsService],
})
export class ExtendedDomainsModule {}
