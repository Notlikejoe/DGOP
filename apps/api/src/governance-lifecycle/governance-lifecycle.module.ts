import { Module } from '@nestjs/common';
import { GovernanceLifecycleController } from './governance-lifecycle.controller';
import { GovernanceLifecycleService } from './governance-lifecycle.service';

@Module({
  controllers: [GovernanceLifecycleController],
  providers: [GovernanceLifecycleService],
})
export class GovernanceLifecycleModule {}
