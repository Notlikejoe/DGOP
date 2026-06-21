import { Module } from '@nestjs/common';
import { AccessService } from './access.service';
import { ScopeService } from './scope.service';

@Module({
  providers: [AccessService, ScopeService],
  exports: [AccessService, ScopeService],
})
export class AccessModule {}
