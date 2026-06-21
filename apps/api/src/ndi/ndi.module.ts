import { Module } from '@nestjs/common';
import { NdiController } from './ndi.controller';
import { NdiSpecificationsService } from './ndi.service';

@Module({
  controllers: [NdiController],
  providers: [NdiSpecificationsService],
})
export class NdiModule {}
