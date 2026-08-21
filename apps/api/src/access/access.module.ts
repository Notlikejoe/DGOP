import { Module } from '@nestjs/common';
import { AccessController } from './access.controller';
import { AccessGrantsService } from './access-grants.service';
import { AccessService } from './access.service';
import { OwnerDelegateValidationService } from './owner-delegate-validation.service';
import { ScopeService } from './scope.service';

@Module({
  controllers: [AccessController],
  providers: [AccessService, ScopeService, OwnerDelegateValidationService, AccessGrantsService],
  exports: [AccessService, ScopeService, OwnerDelegateValidationService, AccessGrantsService],
})
export class AccessModule {}
