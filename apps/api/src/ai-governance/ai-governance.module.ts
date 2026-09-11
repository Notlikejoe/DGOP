import { Module } from '@nestjs/common';
import { AiIdentifiersService } from './ai-identifiers.service';

// Foundation only: intentionally no controllers or scheduled jobs. Business
// endpoints are introduced with the explicit AI permissions in later packets.
@Module({ providers: [AiIdentifiersService], exports: [AiIdentifiersService] })
export class AiGovernanceModule {}
