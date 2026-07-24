import { Body, Controller, Get, Param, Patch, Post } from '@nestjs/common';
import { CurrentUser, RequirePermissions } from '../auth/decorators';
import { AuthUser } from '../auth/auth.types';
import {
  CreateArchitectureReviewDto,
  CreateMdmMatchDto,
  CreateMetadataCertificationDto,
  CreateReferenceVersionDto,
  DecideArchitectureReviewDto,
  ReferenceDecisionDto,
  ResolveMdmMatchDto,
  RunMdmMatchingDto,
  SaveMetadataCertificationDto,
  UpdateMdmGoldenRecordDto,
  UpsertMdmMatchRuleDto,
} from './extended-domains.dto';
import { ExtendedDomainsService } from './extended-domains.service';

@Controller('extended-domains')
export class ExtendedDomainsController {
  constructor(private readonly service: ExtendedDomainsService) {}

  @Get('workspace')
  @RequirePermissions('extended_domains.view')
  workspace(@CurrentUser() user: AuthUser) {
    return this.service.workspace(user.roles);
  }

  @Post('mdm/matches')
  @RequirePermissions('extended_domains.create')
  createMatch(@Body() dto: CreateMdmMatchDto, @CurrentUser() user: AuthUser) {
    return this.service.createMatch(user.roles, dto, user.email);
  }

  @Post('mdm/matches/run')
  @RequirePermissions('extended_domains.create')
  runMdmMatching(@Body() dto: RunMdmMatchingDto, @CurrentUser() user: AuthUser) {
    return this.service.runMdmMatching(user.roles, dto, user.email);
  }

  @Get('mdm/match-rules')
  @RequirePermissions('extended_domains.view')
  mdmMatchRules(@CurrentUser() user: AuthUser) {
    return this.service.listMdmMatchRules(user.roles);
  }

  @Post('mdm/match-rules')
  @RequirePermissions('extended_domains.edit')
  upsertMdmMatchRule(@Body() dto: UpsertMdmMatchRuleDto, @CurrentUser() user: AuthUser) {
    return this.service.upsertMdmMatchRule(user.roles, dto, user.email);
  }

  @Get('mdm/golden-records')
  @RequirePermissions('extended_domains.view')
  mdmGoldenRecords(@CurrentUser() user: AuthUser) {
    return this.service.listGoldenRecords(user.roles);
  }

  @Patch('mdm/golden-records/:id')
  @RequirePermissions('extended_domains.edit')
  updateGoldenRecord(@Param('id') id: string, @Body() dto: UpdateMdmGoldenRecordDto, @CurrentUser() user: AuthUser) {
    return this.service.updateGoldenRecord(user.roles, id, dto, user.email);
  }

  @Patch('mdm/matches/:id')
  @RequirePermissions('extended_domains.edit')
  resolveMatch(@Param('id') id: string, @Body() dto: ResolveMdmMatchDto, @CurrentUser() user: AuthUser) {
    return this.service.resolveMatch(user.roles, id, dto, user.email);
  }

  @Post('reference/versions')
  @RequirePermissions('extended_domains.create')
  createReferenceVersion(@Body() dto: CreateReferenceVersionDto, @CurrentUser() user: AuthUser) {
    return this.service.createReferenceVersion(user.roles, dto, user.email);
  }

  @Patch('reference/versions/:id/decision')
  @RequirePermissions('extended_domains.edit')
  decideReferenceVersion(@Param('id') id: string, @Body() dto: ReferenceDecisionDto, @CurrentUser() user: AuthUser) {
    return this.service.decideReferenceVersion(user.roles, id, dto, user.email);
  }

  @Post('metadata/certifications')
  @RequirePermissions('extended_domains.create')
  createCertification(@Body() dto: CreateMetadataCertificationDto, @CurrentUser() user: AuthUser) {
    return this.service.createCertification(user.roles, dto, user.email);
  }

  @Patch('metadata/certifications/:id')
  @RequirePermissions('extended_domains.edit')
  saveCertification(@Param('id') id: string, @Body() dto: SaveMetadataCertificationDto, @CurrentUser() user: AuthUser) {
    return this.service.saveCertification(user.roles, id, dto, user.email);
  }

  @Post('architecture/reviews')
  @RequirePermissions('extended_domains.create')
  createArchitectureReview(@Body() dto: CreateArchitectureReviewDto, @CurrentUser() user: AuthUser) {
    return this.service.createArchitectureReview(user.roles, dto, user.email);
  }

  @Patch('architecture/reviews/:id/decision')
  @RequirePermissions('extended_domains.edit')
  decideArchitectureReview(@Param('id') id: string, @Body() dto: DecideArchitectureReviewDto, @CurrentUser() user: AuthUser) {
    return this.service.decideArchitectureReview(user.roles, id, dto, user.email);
  }
}
