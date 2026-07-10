import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { AuditModule } from '../audit/audit.module';
import { AccessModule } from '../access/access.module';
import { OpenDataController } from './open-data.controller';
import { OpenDataService } from './open-data.service';

@Module({
  imports: [PrismaModule, AuditModule, AccessModule],
  controllers: [OpenDataController],
  providers: [OpenDataService],
})
export class OpenDataModule {}
