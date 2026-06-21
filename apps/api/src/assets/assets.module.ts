import { Module } from '@nestjs/common';
import { AccessModule } from '../access/access.module';
import { AssetsController } from './assets.controller';
import { AssetsService } from './assets.service';

@Module({
  imports: [AccessModule],
  controllers: [AssetsController],
  providers: [AssetsService],
})
export class AssetsModule {}
