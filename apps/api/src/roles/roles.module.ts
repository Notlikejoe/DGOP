import { Module } from '@nestjs/common';
import { RolesService } from './roles.service';
import { RolesController } from './roles.controller';
import { AccessModule } from '../access/access.module';

@Module({
  imports: [AccessModule],
  controllers: [RolesController],
  providers: [RolesService],
})
export class RolesModule {}
