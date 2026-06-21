import { Module } from '@nestjs/common';
import { AccessModule } from '../access/access.module';
import { ScoringModule } from '../scoring/scoring.module';
import { DashboardController } from './dashboard.controller';
import { DashboardService } from './dashboard.service';

@Module({
  imports: [AccessModule, ScoringModule],
  controllers: [DashboardController],
  providers: [DashboardService],
})
export class DashboardModule {}
