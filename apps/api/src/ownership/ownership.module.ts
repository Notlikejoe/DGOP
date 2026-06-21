import { Module } from '@nestjs/common';
import { AccessModule } from '../access/access.module';
import { PeopleController } from './people.controller';
import { PeopleService } from './people.service';
import { AssignmentsController } from './assignments.controller';
import { AssignmentsService } from './assignments.service';

@Module({
  imports: [AccessModule],
  controllers: [PeopleController, AssignmentsController],
  providers: [PeopleService, AssignmentsService],
  exports: [PeopleService, AssignmentsService],
})
export class OwnershipModule {}
