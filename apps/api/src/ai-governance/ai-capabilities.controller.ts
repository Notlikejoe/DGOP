import { Controller, Get, UnauthorizedException } from '@nestjs/common';
import { CurrentUser } from '../auth/decorators';
import { AuthUser } from '../auth/auth.types';
import { AiAuthorizationService } from './ai-authorization.service';

@Controller('ai/capabilities')
export class AiCapabilitiesController {
  constructor(private readonly authorization: AiAuthorizationService) {}
  @Get()
  // Authenticated self-service: an active user can learn that they have no AI access.
  get(@CurrentUser() user: AuthUser) {
    if(!user?.id)throw new UnauthorizedException('Active authenticated user required');
    return this.authorization.capabilities(user.id);
  }
}
