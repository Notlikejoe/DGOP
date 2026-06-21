import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Res,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { Response } from 'express';
import { EvidenceService, UploadedFile as EvidenceFile } from './evidence.service';
import { CreateEvidenceDto, ReviewEvidenceDto } from './evidence.dto';
import { CurrentUser, RequirePermissions } from '../auth/decorators';
import { AuthUser } from '../auth/auth.types';

const MAX_BYTES = Number(process.env.EVIDENCE_MAX_BYTES ?? 15 * 1024 * 1024);
const ALLOWED_MIME = new Set([
  'application/pdf',
  'image/png',
  'image/jpeg',
  'text/plain',
  'text/csv',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
]);

@Controller()
export class EvidenceController {
  constructor(private readonly service: EvidenceService) {}

  @Get('ndi/specifications/:specId/evidence')
  @RequirePermissions('evidence.view')
  listBySpec(@Param('specId') specId: string) {
    return this.service.listBySpec(specId);
  }

  @Get('evidence/:id')
  @RequirePermissions('evidence.view')
  get(@Param('id') id: string) {
    return this.service.get(id);
  }

  @Post('evidence')
  @RequirePermissions('evidence.create')
  @UseInterceptors(
    FileInterceptor('file', {
      limits: { fileSize: MAX_BYTES },
      fileFilter: (_req, file, cb) => {
        if (ALLOWED_MIME.has(file.mimetype)) return cb(null, true);
        cb(new BadRequestException(`Unsupported file type: ${file.mimetype}`), false);
      },
    }),
  )
  create(
    @UploadedFile() file: EvidenceFile,
    @Body() dto: CreateEvidenceDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.service.create(dto, file, user.email);
  }

  @Post('evidence/:id/submit')
  @RequirePermissions('evidence.create')
  submit(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.service.submit(id, user.email);
  }

  @Post('evidence/:id/review')
  @RequirePermissions('evidence.review')
  review(
    @Param('id') id: string,
    @Body() dto: ReviewEvidenceDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.service.review(id, dto, user.email);
  }

  @Post('evidence/:id/revoke')
  @RequirePermissions('evidence.review')
  revoke(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.service.revoke(id, user.email);
  }

  @Delete('evidence/:id')
  @RequirePermissions('evidence.delete')
  remove(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.service.remove(id, user.email);
  }

  @Get('evidence/:id/file')
  @RequirePermissions('evidence.view')
  async download(
    @Param('id') id: string,
    @CurrentUser() user: AuthUser,
    @Res() res: Response,
  ): Promise<void> {
    const { path, originalName, mimeType } = await this.service.fileFor(id, user.email);
    res.setHeader('Content-Type', mimeType);
    res.download(path, originalName);
  }
}
