import { Body, Controller, Get, Param, Post, Res } from '@nestjs/common';
import type { Response } from 'express';
import { CurrentUser, RequirePermissions } from '../auth/decorators';
import { AuthUser } from '../auth/auth.types';
import { AuditPacksService } from './audit-packs.service';
import { CreateNdiAuditPackDto } from './audit-packs.dto';

@Controller('ndi/audit-packs')
export class AuditPacksController {
  constructor(private readonly service: AuditPacksService) {}

  @Get()
  @RequirePermissions('ndi_audit_packs.view')
  list() {
    return this.service.list();
  }

  @Post('readiness')
  @RequirePermissions('ndi_audit_packs.view')
  readiness(@Body() dto: CreateNdiAuditPackDto) {
    return this.service.readiness(dto.domainId);
  }

  @Post()
  @RequirePermissions('ndi_audit_packs.generate')
  generate(@Body() dto: CreateNdiAuditPackDto, @CurrentUser() user: AuthUser) {
    return this.service.generate(dto, user);
  }

  @Get(':id/export')
  @RequirePermissions('ndi_audit_packs.download')
  async export(@Param('id') id: string, @CurrentUser() user: AuthUser, @Res() res: Response) {
    const file = await this.service.exportZip(id, user);
    res.setHeader('Content-Type', file.contentType);
    res.setHeader('Content-Disposition', `attachment; filename="${file.filename}"`);
    res.send(file.body);
  }
}
