import { Module } from '@nestjs/common';
import { AccessModule } from '../access/access.module';
import { PrismaModule } from '../prisma/prisma.module';
import { TransparencyController } from './transparency.controller';
import { TransparencyService } from './transparency.service';

@Module({
  imports: [PrismaModule, AccessModule],
  controllers: [TransparencyController],
  providers: [TransparencyService],
})
export class TransparencyModule {}
