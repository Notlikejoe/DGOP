import { Module } from '@nestjs/common';
import { AiIdentifiersService } from './ai-identifiers.service';
import { AiAuthorizationService } from './ai-authorization.service';

// Foundation only: intentionally no controllers or scheduled jobs. Business
// endpoints are introduced with the explicit AI permissions in later packets.
@Module({ providers: [AiIdentifiersService, AiAuthorizationService], exports: [AiIdentifiersService, AiAuthorizationService] })
export class AiGovernanceModule {}
