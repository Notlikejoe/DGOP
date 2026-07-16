import { Module } from '@nestjs/common';
import { ScoringModule } from '../scoring/scoring.module';
import { AuditPacksController } from './audit-packs.controller';
import { AuditPacksService } from './audit-packs.service';

@Module({
  imports: [ScoringModule],
  controllers: [AuditPacksController],
  providers: [AuditPacksService],
})
export class AuditPacksModule {}
