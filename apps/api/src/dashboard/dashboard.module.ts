import { Module } from '@nestjs/common';
import { AccessModule } from '../access/access.module';
import { ScoringModule } from '../scoring/scoring.module';
import { DataQualityModule } from '../data-quality/data-quality.module';
import { DashboardController } from './dashboard.controller';
import { DashboardService } from './dashboard.service';

@Module({
  imports: [AccessModule, ScoringModule, DataQualityModule],
  controllers: [DashboardController],
  providers: [DashboardService],
})
export class DashboardModule {}
