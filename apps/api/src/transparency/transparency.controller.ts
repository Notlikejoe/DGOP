import { Controller, Get } from '@nestjs/common';
import { CurrentUser, RequirePermissions } from '../auth/decorators';
import { AuthUser } from '../auth/auth.types';
import { TransparencyService } from './transparency.service';

@Controller('transparency')
export class TransparencyController {
  constructor(private readonly service: TransparencyService) {}

  @Get('cockpit')
  @RequirePermissions('dashboard.view')
  cockpit(@CurrentUser() user: AuthUser) {
    return this.service.cockpit(user);
  }
}
