import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { AuditModule } from '../audit/audit.module';
import { TrainingController } from './training.controller';
import { TrainingService } from './training.service';

@Module({
  imports: [PrismaModule, AuditModule],
  controllers: [TrainingController],
  providers: [TrainingService],
})
export class TrainingModule {}
