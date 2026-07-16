import { Module } from '@nestjs/common';
import { AccessModule } from '../access/access.module';
import { PrismaModule } from '../prisma/prisma.module';
import { ReportsController } from './reports.controller';
import { ReportsService } from './reports.service';

@Module({
  imports: [PrismaModule, AccessModule],
  controllers: [ReportsController],
  providers: [ReportsService],
})
export class ReportsModule {}
