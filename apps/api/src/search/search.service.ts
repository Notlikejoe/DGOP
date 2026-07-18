import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { AuthUser } from '../auth/auth.types';
import { AccessService } from '../access/access.service';
import { EffectiveScope, ScopeService } from '../access/scope.service';
import { PrismaService } from '../prisma/prisma.service';
import { GlobalSearchResponse, SearchGroup, SearchResult } from './search.types';

const DEFAULT_LIMIT = 5;
const MAX_LIMIT = 8;
const MIN_QUERY_LENGTH = 2;

const refSelect = { select: { code: true, nameEn: true, nameAr: true } };

@Injectable()
export class SearchService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: AccessService,
    private readonly scope: ScopeService,
  ) {}

  async search(
    user: AuthUser,
    rawQuery?: string,
    rawLimit?: string | number,
  ): Promise<GlobalSearchResponse> {
    const query = (rawQuery ?? '').trim();
    if (query.length < MIN_QUERY_LENGTH) return { query, total: 0, groups: [] };

    const limit = this.parseLimit(rawLimit);
    const granted = await this.access.permissionsForRoleCodes(user.roles);
    const can = (permission: string) => this.access.hasPermission(granted, permission);
    const [scope, assetIds] = await Promise.all([
      this.scope.resolve(user.roles),
      this.visibleAssetIds(user.roles),
    ]);

    const groupPromises: Promise<SearchGroup | null>[] = [];
    if (can('data_assets.view')) groupPromises.push(this.searchAssets(query, limit, scope));
    if (can('people.view')) groupPromises.push(this.searchPeople(query, limit));
    if (can('roles.view')) groupPromises.push(this.searchRoles(query, limit));
    if (can('workflow_cases.view')) groupPromises.push(this.searchWorkflow(query, limit, assetIds, user));
    if (can('ndi_specifications.view')) groupPromises.push(this.searchNdi(query, limit));
    if (can('data_quality_issues.view')) groupPromises.push(this.searchDataQuality(query, limit, assetIds));
    if (can('open_data_candidates.view')) groupPromises.push(this.searchOpenData(query, limit, assetIds));
    if (can('foi_requests.view')) groupPromises.push(this.searchFoi(query, limit, assetIds));
    if (can('integrations.view')) groupPromises.push(this.searchIntegrations(query, limit));
    if (
      can('data_domains.view') ||
      can('org_units.view') ||
      can('systems.view') ||
      can('business_capabilities.view')
    ) {
      groupPromises.push(this.searchReferenceData(query, limit, can));
    }

    const groups = (await Promise.all(groupPromises)).filter(
      (group): group is SearchGroup => !!group && group.results.length > 0,
    );
    return {
      query,
      total: groups.reduce((sum, group) => sum + group.count, 0),
      groups,
    };
  }

  private parseLimit(value?: string | number): number {
    const parsed = Math.floor(Number(value)) || DEFAULT_LIMIT;
    return Math.min(MAX_LIMIT, Math.max(1, parsed));
  }

  private contains(term: string) {
    return { contains: term, mode: Prisma.QueryMode.insensitive };
  }

  private assetScopeWhere(scope: EffectiveScope): Prisma.DataAssetWhereInput {
    const where: Prisma.DataAssetWhereInput = { deletedAt: null };
    if (scope.orgUnits !== 'all') where.orgUnitId = { in: scope.orgUnits };
    if (scope.domains !== 'all') where.domainId = { in: scope.domains };
    if (scope.maxClassRank != null) {
      where.OR = [
        { classificationId: null },
        { classification: { rank: { lte: scope.maxClassRank } } },
      ];
    }
    return where;
  }

  private async visibleAssetIds(roleCodes: string[]): Promise<Set<string> | 'all'> {
    const scope = await this.scope.resolve(roleCodes);
    const unrestricted =
      scope.orgUnits === 'all' && scope.domains === 'all' && scope.maxClassRank == null;
    if (unrestricted) return 'all';
    const rows = await this.prisma.dataAsset.findMany({
      where: this.assetScopeWhere(scope),
      select: { id: true },
    });
    return new Set(rows.map((row) => row.id));
  }

  private assetLinkedWhere(assetIds: Set<string> | 'all', includeUnlinked: boolean) {
    if (assetIds === 'all') return {};
    const scopedAssetWhere = assetIds.size > 0 ? { assetId: { in: [...assetIds] } } : null;
    if (includeUnlinked && scopedAssetWhere) return { OR: [{ assetId: null }, scopedAssetWhere] };
    if (includeUnlinked) return { assetId: null };
    return scopedAssetWhere ?? { id: { equals: '__no_visible_records__' } };
  }

  private workflowCaseScopeWhere(
    assetIds: Set<string> | 'all',
    user: AuthUser,
  ): Prisma.WorkflowCaseWhereInput {
    if (assetIds === 'all') return {};
    const taskVisibility: Prisma.WorkflowTaskWhereInput[] = [{ assigneeUserId: user.id }];
    if (user.roles.length) {
      taskVisibility.push({
        assigneeUserId: null,
        OR: [
          { assigneeRoleCode: { in: user.roles } },
          { templateStage: { assigneeRoleCode: { in: user.roles } } },
        ],
      });
    }
    const visible: Prisma.WorkflowCaseWhereInput[] = [];
    if (assetIds.size > 0) visible.push({ assetId: { in: [...assetIds] } });
    visible.push(
      { AND: [{ assetId: null }, { createdBy: user.email }] },
      { AND: [{ assetId: null }, { tasks: { some: { OR: taskVisibility } } }] },
    );
    return visible.length ? { OR: visible } : { id: { equals: '__no_visible_records__' } };
  }

  private requiredAssetLinkedWhere(assetIds: Set<string> | 'all'): Prisma.OpenDataCandidateWhereInput {
    if (assetIds === 'all') return {};
    if (assetIds.size === 0) return { id: { equals: '__no_visible_records__' } };
    return { assetId: { in: [...assetIds] } };
  }

  private group(type: SearchGroup['type'], results: SearchResult[]): SearchGroup | null {
    return results.length ? { type, count: results.length, results } : null;
  }

  private async searchAssets(
    query: string,
    limit: number,
    scope: EffectiveScope,
  ): Promise<SearchGroup | null> {
    const rows = await this.prisma.dataAsset.findMany({
      where: {
        AND: [
          this.assetScopeWhere(scope),
          {
            OR: [
              { code: this.contains(query) },
              { nameEn: this.contains(query) },
              { nameAr: this.contains(query) },
              { description: this.contains(query) },
              { ownerName: this.contains(query) },
            ],
          },
        ],
      },
      select: {
        id: true,
        code: true,
        nameEn: true,
        nameAr: true,
        ownerName: true,
        lifecycleStatus: true,
        domain: refSelect,
        classification: refSelect,
      },
      orderBy: { updatedAt: 'desc' },
      take: limit,
    });
    return this.group(
      'assets',
      rows.map((row) => ({
        id: row.id,
        entityType: 'asset',
        title: row.nameEn,
        subtitle: row.code,
        detail: row.ownerName ?? row.domain?.nameEn ?? row.classification?.nameEn ?? null,
        status: row.lifecycleStatus,
        route: { path: '/assets', queryParams: { assetId: row.id } },
      })),
    );
  }

  private async searchPeople(query: string, limit: number): Promise<SearchGroup | null> {
    const rows = await this.prisma.person.findMany({
      where: {
        deletedAt: null,
        OR: [
          { fullNameEn: this.contains(query) },
          { fullNameAr: this.contains(query) },
          { email: this.contains(query) },
          { jobTitle: this.contains(query) },
          { organization: this.contains(query) },
        ],
      },
      select: { id: true, fullNameEn: true, email: true, jobTitle: true, organization: true, isActive: true },
      orderBy: { fullNameEn: 'asc' },
      take: limit,
    });
    return this.group(
      'people',
      rows.map((row) => ({
        id: row.id,
        entityType: 'person',
        title: row.fullNameEn,
        subtitle: row.email,
        detail: row.jobTitle ?? row.organization ?? null,
        status: row.isActive ? 'active' : 'inactive',
        route: { path: '/admin/people' },
      })),
    );
  }

  private async searchRoles(query: string, limit: number): Promise<SearchGroup | null> {
    const rows = await this.prisma.role.findMany({
      where: {
        deletedAt: null,
        OR: [
          { code: this.contains(query) },
          { nameEn: this.contains(query) },
          { nameAr: this.contains(query) },
          { description: this.contains(query) },
        ],
      },
      select: { id: true, code: true, nameEn: true, description: true, isSystem: true, isActive: true },
      orderBy: { nameEn: 'asc' },
      take: limit,
    });
    return this.group(
      'roles',
      rows.map((row) => ({
        id: row.id,
        entityType: 'role',
        title: row.nameEn,
        subtitle: row.code,
        detail: row.description,
        status: row.isSystem ? 'system' : row.isActive ? 'active' : 'inactive',
        route: { path: '/admin/roles' },
      })),
    );
  }

  private async searchWorkflow(
    query: string,
    limit: number,
    assetIds: Set<string> | 'all',
    user: AuthUser,
  ): Promise<SearchGroup | null> {
    const rows = await this.prisma.workflowCase.findMany({
      where: {
        AND: [
          this.workflowCaseScopeWhere(assetIds, user),
          {
            OR: [
              { code: this.contains(query) },
              { title: this.contains(query) },
              { description: this.contains(query) },
              { type: this.contains(query) },
            ],
          },
        ],
      },
      select: { id: true, code: true, title: true, type: true, status: true, asset: { select: { code: true, nameEn: true } } },
      orderBy: { updatedAt: 'desc' },
      take: limit,
    });
    return this.group(
      'workflow',
      rows.map((row) => ({
        id: row.id,
        entityType: 'workflow_case',
        title: row.title,
        subtitle: row.code,
        detail: row.asset ? `${row.asset.code} - ${row.asset.nameEn}` : row.type,
        status: row.status,
        route: { path: `/governance/workflow/cases/${row.id}` },
      })),
    );
  }

  private async searchNdi(query: string, limit: number): Promise<SearchGroup | null> {
    const rows = await this.prisma.ndiSpecification.findMany({
      where: {
        deletedAt: null,
        isActive: true,
        OR: [
          { code: this.contains(query) },
          { nameEn: this.contains(query) },
          { nameAr: this.contains(query) },
          { descriptionEn: this.contains(query) },
          { descriptionAr: this.contains(query) },
          { criterion: this.contains(query) },
          { acceptanceCriteria: this.contains(query) },
          { reference: this.contains(query) },
        ],
      },
      select: { id: true, code: true, nameEn: true, type: true, maturityLevel: true, domain: { select: { nameEn: true } } },
      orderBy: { code: 'asc' },
      take: limit,
    });
    return this.group(
      'ndi',
      rows.map((row) => ({
        id: row.id,
        entityType: 'ndi_specification',
        title: row.nameEn,
        subtitle: row.code,
        detail: row.domain.nameEn,
        status: `${row.type} / ${row.maturityLevel}`,
        route: { path: `/governance/ndi/specifications/${row.id}` },
      })),
    );
  }

  private async searchDataQuality(
    query: string,
    limit: number,
    assetIds: Set<string> | 'all',
  ): Promise<SearchGroup | null> {
    const rows = await this.prisma.dataQualityIssue.findMany({
      where: {
        AND: [
          { deletedAt: null },
          this.assetLinkedWhere(assetIds, true),
          {
            OR: [
              { code: this.contains(query) },
              { title: this.contains(query) },
              { description: this.contains(query) },
              { source: this.contains(query) },
            ],
          },
        ],
      },
      select: {
        id: true,
        code: true,
        title: true,
        severity: true,
        status: true,
        asset: { select: { code: true, nameEn: true } },
      },
      orderBy: { updatedAt: 'desc' },
      take: limit,
    });
    return this.group(
      'dataQuality',
      rows.map((row) => ({
        id: row.id,
        entityType: 'data_quality_issue',
        title: row.title,
        subtitle: row.code,
        detail: row.asset ? `${row.asset.code} - ${row.asset.nameEn}` : row.severity,
        status: row.status,
        route: { path: '/governance/data-quality', queryParams: { issueId: row.id } },
      })),
    );
  }

  private async searchOpenData(
    query: string,
    limit: number,
    assetIds: Set<string> | 'all',
  ): Promise<SearchGroup | null> {
    const rows = await this.prisma.openDataCandidate.findMany({
      where: {
        AND: [
          { deletedAt: null },
          this.requiredAssetLinkedWhere(assetIds),
          {
            OR: [
              { code: this.contains(query) },
              { titleEn: this.contains(query) },
              { titleAr: this.contains(query) },
              { description: this.contains(query) },
              { portalUrl: this.contains(query) },
            ],
          },
        ],
      },
      select: {
        id: true,
        code: true,
        titleEn: true,
        status: true,
        eligibilityScore: true,
        asset: { select: { code: true, nameEn: true } },
      },
      orderBy: { updatedAt: 'desc' },
      take: limit,
    });
    return this.group(
      'openData',
      rows.map((row) => ({
        id: row.id,
        entityType: 'open_data_candidate',
        title: row.titleEn,
        subtitle: row.code,
        detail: `${row.asset.code} - ${row.asset.nameEn}`,
        status: `${row.status} / ${row.eligibilityScore}%`,
        route: { path: `/governance/open-data/${row.id}` },
      })),
    );
  }

  private async searchFoi(
    query: string,
    limit: number,
    assetIds: Set<string> | 'all',
  ): Promise<SearchGroup | null> {
    const rows = await this.prisma.foiRequest.findMany({
      where: {
        AND: [
          { deletedAt: null },
          this.assetLinkedWhere(assetIds, true),
          {
            OR: [
              { requestNumber: this.contains(query) },
              { requesterName: this.contains(query) },
              { requesterEmail: this.contains(query) },
              { subject: this.contains(query) },
              { description: this.contains(query) },
            ],
          },
        ],
      },
      select: {
        id: true,
        requestNumber: true,
        requesterName: true,
        subject: true,
        status: true,
        dueAt: true,
        asset: { select: { code: true, nameEn: true } },
      },
      orderBy: { dueAt: 'asc' },
      take: limit,
    });
    return this.group(
      'foi',
      rows.map((row) => ({
        id: row.id,
        entityType: 'foi_request',
        title: row.subject,
        subtitle: row.requestNumber,
        detail: row.asset ? `${row.asset.code} - ${row.asset.nameEn}` : row.requesterName,
        status: row.status,
        route: { path: `/governance/foi/${row.id}` },
      })),
    );
  }

  private async searchIntegrations(query: string, limit: number): Promise<SearchGroup | null> {
    const rows = await this.prisma.integrationConnector.findMany({
      where: {
        deletedAt: null,
        OR: [
          { code: this.contains(query) },
          { nameEn: this.contains(query) },
          { nameAr: this.contains(query) },
          { description: this.contains(query) },
        ],
      },
      select: { id: true, code: true, nameEn: true, type: true, status: true, sourceTrust: true },
      orderBy: { nameEn: 'asc' },
      take: limit,
    });
    return this.group(
      'integrations',
      rows.map((row) => ({
        id: row.id,
        entityType: 'integration_connector',
        title: row.nameEn,
        subtitle: row.code,
        detail: `${row.type} / ${row.sourceTrust}`,
        status: row.status,
        route: { path: '/admin/integrations' },
      })),
    );
  }

  private async searchReferenceData(
    query: string,
    limit: number,
    can: (permission: string) => boolean,
  ): Promise<SearchGroup | null> {
    const resultSets: SearchResult[][] = [];
    const namedWhere = {
      deletedAt: null,
      OR: [
        { code: this.contains(query) },
        { nameEn: this.contains(query) },
        { nameAr: this.contains(query) },
      ],
    };
    const describedWhere = {
      ...namedWhere,
      OR: [...namedWhere.OR, { description: this.contains(query) }],
    };

    if (can('data_domains.view')) {
      const rows = await this.prisma.dataDomain.findMany({
        where: describedWhere,
        select: { id: true, code: true, nameEn: true, isActive: true },
        orderBy: { nameEn: 'asc' },
        take: limit,
      });
      resultSets.push(rows.map((row) => this.referenceResult(row, 'data_domain', '/admin/data-domains')));
    }
    if (can('org_units.view')) {
      const rows = await this.prisma.organizationUnit.findMany({
        where: namedWhere,
        select: { id: true, code: true, nameEn: true, isActive: true },
        orderBy: { nameEn: 'asc' },
        take: limit,
      });
      resultSets.push(rows.map((row) => this.referenceResult(row, 'org_unit', '/admin/org-units')));
    }
    if (can('systems.view')) {
      const rows = await this.prisma.systemPlatform.findMany({
        where: describedWhere,
        select: { id: true, code: true, nameEn: true, isActive: true, type: true, vendor: true },
        orderBy: { nameEn: 'asc' },
        take: limit,
      });
      resultSets.push(
        rows.map((row) => ({
          ...this.referenceResult(row, 'system', '/admin/systems'),
          detail: row.vendor ?? row.type ?? null,
        })),
      );
    }
    if (can('business_capabilities.view')) {
      const rows = await this.prisma.businessCapability.findMany({
        where: describedWhere,
        select: { id: true, code: true, nameEn: true, isActive: true },
        orderBy: { nameEn: 'asc' },
        take: limit,
      });
      resultSets.push(rows.map((row) => this.referenceResult(row, 'business_capability', '/admin/capabilities')));
    }

    return this.group('reference', resultSets.flat().slice(0, limit));
  }

  private referenceResult(
    row: { id: string; code: string; nameEn: string; isActive: boolean },
    entityType: string,
    path: string,
  ): SearchResult {
    return {
      id: row.id,
      entityType,
      title: row.nameEn,
      subtitle: row.code,
      status: row.isActive ? 'active' : 'inactive',
      route: { path },
    };
  }
}
