import { createHash } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { AuthUser } from '../auth/auth.types';
import { AccessService } from '../access/access.service';
import { EffectiveScope, ScopeService } from '../access/scope.service';
import { PrismaService } from '../prisma/prisma.service';
import { GlobalSearchResponse, SearchGroup, SearchResult } from './search.types';
import { SaveSearchDto, SearchAnalyticsClickDto, UpsertSearchRegistryDto } from './search.dto';
import { protectSearchQuery, revealSearchQuery } from './search.crypto';
import { createExternalSearchEngineFromEnv } from './search.engine';
import {
  ParsedSearchQuery,
  SearchVisibility,
  buildSearchKeywords,
  facetSearchResults,
  groupSearchResults,
  parseAdvancedSearchQuery,
  resultMatchesAdvancedQuery,
  resultPassesDls,
  normalizeSearchText,
} from './search.logic';

const DEFAULT_LIMIT = 5;
const MAX_LIMIT = 8;
const MIN_QUERY_LENGTH = 2;

const refSelect = { select: { code: true, nameEn: true, nameAr: true } };

interface SearchIndexUpsert {
  entityType: string;
  entityId: string;
  title: string;
  subtitle?: string | null;
  detail?: string | null;
  status?: string | null;
  route: { path: string; queryParams?: Record<string, string> };
  permission?: string | null;
  source?: string | null;
  externalSystem?: string | null;
  metadata?: Record<string, unknown> | null;
  visibility?: SearchVisibility | null;
}

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
    const parsed = parseAdvancedSearchQuery(query);
    if (
      parsed.freeText.length < MIN_QUERY_LENGTH &&
      parsed.tokens.length === 0 &&
      !parsed.hasStructuredFilters
    ) {
      return { query, total: 0, groups: [], facets: [] };
    }

    const limit = this.parseLimit(rawLimit);
    const granted = await this.access.permissionsForRoleCodes(user.roles);
    const can = (permission: string) => this.access.hasPermission(granted, permission);
    const [scope, assetIds] = await Promise.all([
      this.scope.resolve(user.roles),
      this.visibleAssetIds(user.roles),
    ]);

    const directQuery = parsed.freeText || parsed.normalizedText || query;
    const groupPromises: Promise<SearchGroup | null>[] = [];
    if (this.typeRequested(parsed, 'asset') && can('data_assets.view')) groupPromises.push(this.searchAssets(directQuery, limit, scope));
    if (this.typeRequested(parsed, 'person', 'user') && can('people.view')) groupPromises.push(this.searchPeople(directQuery, limit));
    if (this.typeRequested(parsed, 'role') && can('roles.view')) groupPromises.push(this.searchRoles(directQuery, limit));
    if (this.typeRequested(parsed, 'workflow_case', 'workflow') && can('workflow_cases.view')) {
      groupPromises.push(this.searchWorkflow(directQuery, limit, assetIds, user));
    }
    if (this.typeRequested(parsed, 'ndi_specification', 'ndi') && can('ndi_specifications.view')) {
      groupPromises.push(this.searchNdi(directQuery, limit, scope, user));
    }
    if (this.typeRequested(parsed, 'data_quality_issue', 'quality') && can('data_quality_issues.view')) {
      groupPromises.push(this.searchDataQuality(directQuery, limit, assetIds, user));
    }
    if (this.typeRequested(parsed, 'open_data_candidate', 'open_data') && can('open_data_candidates.view')) {
      groupPromises.push(this.searchOpenData(directQuery, limit, assetIds));
    }
    if (this.typeRequested(parsed, 'foi_request', 'foi') && can('foi_requests.view')) {
      groupPromises.push(this.searchFoi(directQuery, limit, scope, assetIds));
    }
    if (this.typeRequested(parsed, 'integration_connector', 'integration') && can('integrations.view')) {
      groupPromises.push(this.searchIntegrations(directQuery, limit));
    }
    if (
      this.typeRequested(parsed, 'reference', 'data_domain', 'org_unit', 'system', 'business_capability') &&
      (can('data_domains.view') ||
        can('org_units.view') ||
        can('systems.view') ||
        can('business_capabilities.view'))
    ) {
      groupPromises.push(this.searchReferenceData(directQuery, limit, can));
    }

    const directGroups = (await Promise.all(groupPromises)).filter(
      (group): group is SearchGroup => !!group && group.results.length > 0,
    );
    const indexedGroups = await this.searchIndexRecords(user, parsed, limit, scope, granted);
    const external = await createExternalSearchEngineFromEnv().search(parsed, limit * 4);
    const externalResults = external.results
      .filter((result) => resultMatchesAdvancedQuery(result, parsed))
      .filter((result) =>
        resultPassesDls(result, scope, user, granted, (permissions, required) =>
          this.access.hasPermission(permissions, required),
        ),
      )
      .slice(0, limit);
    const groups = this.mergeGroups([
      ...directGroups,
      ...indexedGroups,
      ...groupSearchResults(externalResults),
    ], parsed, limit);
    const response = {
      query,
      total: groups.reduce((sum, group) => sum + group.count, 0),
      groups,
      facets: this.mergeFacets(facetSearchResults(groups), external.facets),
      parsed: {
        terms: [...new Set([...parsed.tokens, ...parsed.arabicTokens])],
        filters: parsed.filters,
        excludedTerms: parsed.excludedTerms,
        sort: parsed.sort,
      },
      engines: [
        { name: 'database', status: 'available' as const },
        { name: 'search_index_cdc', status: this.hasSearchIndexClient() ? 'available' as const : 'skipped' as const },
        { name: external.diagnostics.backend, status: external.diagnostics.status, message: external.diagnostics.message },
      ],
      security: { dlsApplied: true, queryProtected: true },
    };
    await this.recordSearchAnalytics(user, query, response.total, 'global_search');
    return response;
  }

  async autocomplete(user: AuthUser, rawQuery?: string, rawLimit?: string | number) {
    const response = await this.search(user, rawQuery, rawLimit);
    const suggestions = response.groups
      .flatMap((group) =>
        group.results.map((result) => ({
          label: result.title,
          subtitle: result.subtitle,
          entityType: result.entityType,
          route: result.route,
        })),
      )
      .slice(0, this.parseLimit(rawLimit));
    return { query: response.query, total: suggestions.length, suggestions };
  }

  async registry() {
    await this.ensureDefaultRegistry();
    return this.prisma.searchableObjectRegistry.findMany({
      where: { isActive: true },
      orderBy: [{ rankWeight: 'desc' }, { entityType: 'asc' }],
    });
  }

  async upsertRegistry(dto: UpsertSearchRegistryDto, user: AuthUser) {
    const row = await this.prisma.searchableObjectRegistry.upsert({
      where: { code: dto.code },
      create: {
        code: dto.code,
        entityType: dto.entityType,
        nameEn: dto.nameEn,
        nameAr: dto.nameAr ?? null,
        routeTemplate: dto.routeTemplate,
        permission: dto.permission,
        fieldsJson: dto.fieldsJson as Prisma.InputJsonObject,
        rankWeight: dto.rankWeight ?? 50,
        indexStrategy: dto.indexStrategy ?? 'database',
        includeInAutocomplete: dto.includeInAutocomplete ?? true,
        isActive: dto.isActive ?? true,
      },
      update: {
        entityType: dto.entityType,
        nameEn: dto.nameEn,
        nameAr: dto.nameAr ?? null,
        routeTemplate: dto.routeTemplate,
        permission: dto.permission,
        fieldsJson: dto.fieldsJson as Prisma.InputJsonObject,
        rankWeight: dto.rankWeight ?? 50,
        indexStrategy: dto.indexStrategy ?? 'database',
        includeInAutocomplete: dto.includeInAutocomplete ?? true,
        isActive: dto.isActive ?? true,
      },
    });
    await this.prisma.searchAnalyticsEvent.create({
      data: {
        userId: user.id,
        ...this.protectedQueryData(`registry:${row.code}`),
        resultCount: 1,
        selectedEntityType: 'searchable_object_registry',
        selectedEntityId: row.id,
        source: 'search_admin',
      },
    });
    await this.enqueueIndexChange('searchable_object_registry', row.id, 'upsert', {
      title: row.nameEn,
      subtitle: row.code,
      detail: row.entityType,
      route: { path: '/governance-map' },
      permission: row.permission,
      source: 'registry',
    });
    return row;
  }

  async engineStatus() {
    const external = createExternalSearchEngineFromEnv();
    const pending = this.hasSearchCdcClient()
      ? await (this.prisma as unknown as any).searchIndexChangeEvent.count({ where: { status: 'queued' } })
      : 0;
    const indexedRecords = this.hasSearchIndexClient()
      ? await (this.prisma as unknown as any).searchIndexRecord.count({ where: { isDeleted: false } })
      : 0;
    return {
      database: { status: 'available', indexedRecords, pendingCdcEvents: pending },
      external: {
        backend: external.backend,
        status: external.enabled ? 'configured' : 'not_configured',
        endpointConfigured: external.enabled,
      },
      security: {
        queryEncryption: 'enabled',
        resultDls: 'enabled',
        arabicNlp: 'enabled',
        advancedQueryLanguage: 'enabled',
        facets: 'enabled',
      },
    };
  }

  async refreshIndex(user: AuthUser) {
    const records = await this.buildCoreIndexRecords();
    const indexed = await this.upsertIndexRecords(records, 'refresh');
    await this.recordSearchAnalytics(user, 'index:refresh', indexed.localIndexed, 'search_index_cdc');
    return indexed;
  }

  async processIndexChanges(user: AuthUser, rawLimit?: string | number) {
    const client = this.searchCdcClient();
    if (!client) return { processed: 0, failed: 0, skipped: true };
    const limit = this.parseLimit(rawLimit) * 5;
    const events = await client.findMany({
      where: { status: 'queued' },
      orderBy: { queuedAt: 'asc' },
      take: limit,
    });
    let processed = 0;
    let failed = 0;
    for (const event of events) {
      try {
        if (event.operation === 'delete') {
          await this.searchIndexClient()?.updateMany({
            where: { entityType: event.entityType, entityId: event.entityId },
            data: { isDeleted: true, lastCdcEventId: event.id },
          });
        } else if (event.payloadJson && typeof event.payloadJson === 'object') {
          const payload = event.payloadJson as unknown as SearchIndexUpsert;
          await this.upsertIndexRecords([
            {
              ...payload,
              entityType: event.entityType,
              entityId: event.entityId,
              visibility: (event.visibilityJson as SearchVisibility | null) ?? payload.visibility ?? null,
            },
          ], event.id);
        } else {
          throw new Error('CDC event has no index payload.');
        }
        await client.update({
          where: { id: event.id },
          data: { status: 'processed', attempts: event.attempts + 1, processedAt: new Date(), resultMessage: 'Indexed' },
        });
        processed++;
      } catch (error) {
        failed++;
        await client.update({
          where: { id: event.id },
          data: {
            status: event.attempts >= 2 ? 'failed' : 'queued',
            attempts: event.attempts + 1,
            errorMessage: error instanceof Error ? error.message : 'Indexing failed.',
          },
        });
      }
    }
    await this.recordSearchAnalytics(user, 'index:process-cdc', processed, 'search_index_cdc');
    return { processed, failed, skipped: false };
  }

  async savedSearches(user: AuthUser) {
    const rows = await this.prisma.savedSearch.findMany({
      where: { userId: user.id },
      orderBy: [{ isDefault: 'desc' }, { updatedAt: 'desc' }],
    });
    return rows.map((row) => ({
      ...row,
      query: revealSearchQuery(
        (row as unknown as { queryCiphertextJson?: unknown }).queryCiphertextJson,
        row.query,
      ),
    }));
  }

  async saveSearch(dto: SaveSearchDto, user: AuthUser) {
    if (dto.isDefault) {
      await this.prisma.savedSearch.updateMany({
        where: { userId: user.id, isDefault: true, name: { not: dto.name } },
        data: { isDefault: false },
      });
    }
    return this.prisma.savedSearch.upsert({
      where: { userId_name: { userId: user.id, name: dto.name } },
      create: {
        userId: user.id,
        name: dto.name,
        ...this.protectedQueryData(dto.query),
        filtersJson: (dto.filtersJson ?? Prisma.JsonNull) as Prisma.InputJsonValue,
        isDefault: dto.isDefault ?? false,
      },
      update: {
        ...this.protectedQueryData(dto.query),
        filtersJson: (dto.filtersJson ?? Prisma.JsonNull) as Prisma.InputJsonValue,
        isDefault: dto.isDefault ?? false,
      },
    });
  }

  async recordClick(dto: SearchAnalyticsClickDto, user: AuthUser) {
    const analyticsClient = (
      this.prisma as unknown as {
        searchAnalyticsEvent?: {
          create: typeof this.prisma.searchAnalyticsEvent.create;
        };
      }
    ).searchAnalyticsEvent;
    if (!analyticsClient?.create) return null;
    return analyticsClient.create({
      data: {
        userId: user.id,
        ...this.protectedQueryData(dto.query),
        resultCount: dto.resultCount ?? 0,
        selectedEntityType: dto.selectedEntityType,
        selectedEntityId: dto.selectedEntityId,
        source: dto.source ?? 'global_search',
      },
    });
  }

  private async recordSearchAnalytics(user: AuthUser, query: string, resultCount: number, source: string): Promise<void> {
    const analyticsClient = (
      this.prisma as unknown as {
        searchAnalyticsEvent?: {
          create: typeof this.prisma.searchAnalyticsEvent.create;
        };
      }
    ).searchAnalyticsEvent;
    if (!analyticsClient?.create) return;
    await analyticsClient.create({
      data: { userId: user.id, ...this.protectedQueryData(query), resultCount, source },
    });
  }

  private async ensureDefaultRegistry(): Promise<void> {
    const existing = await this.prisma.searchableObjectRegistry.count();
    if (existing > 0) return;
    await this.prisma.searchableObjectRegistry.createMany({
      data: [
        registryRow('assets', 'asset', 'Data assets', '/assets?assetId={id}', 'data_assets.view', ['code', 'nameEn', 'nameAr', 'ownerName', 'description'], 95),
        registryRow('workflow', 'workflow_case', 'Workflow cases', '/governance/workflow/cases/{id}', 'workflow_cases.view', ['code', 'title', 'type', 'description'], 90),
        registryRow('dq_issues', 'data_quality_issue', 'Data quality issues', '/governance/data-quality?issueId={id}', 'data_quality_issues.view', ['code', 'title', 'description', 'source'], 85),
        registryRow('people', 'person', 'People directory', '/admin/people', 'people.view', ['fullNameEn', 'fullNameAr', 'email', 'jobTitle'], 80),
        registryRow('ndi', 'ndi_specification', 'NDI specifications', '/governance/ndi/specifications/{id}', 'ndi_specifications.view', ['code', 'nameEn', 'descriptionEn', 'criterion'], 75),
      ],
      skipDuplicates: true,
    });
  }

  private parseLimit(value?: string | number): number {
    const parsed = Math.floor(Number(value)) || DEFAULT_LIMIT;
    return Math.min(MAX_LIMIT, Math.max(1, parsed));
  }

  private protectedQueryData(query: string) {
    const protectedQuery = protectSearchQuery(query);
    return {
      query: protectedQuery.protectedQueryMarker,
      queryHash: protectedQuery.queryHash,
      queryCiphertextJson: protectedQuery.queryCiphertextJson as Prisma.InputJsonObject,
      queryProtected: true,
    };
  }

  private typeRequested(parsed: ParsedSearchQuery, ...types: string[]): boolean {
    const requested = parsed.filters.type ?? [];
    if (requested.length === 0) return true;
    return requested.some((value) => {
      const normalized = normalizeSearchText(value).replace(/s$/, '');
      return types.some((type) => {
        const candidate = normalizeSearchText(type).replace(/s$/, '');
        return normalized.includes(candidate) || candidate.includes(normalized);
      });
    });
  }

  private mergeGroups(groups: SearchGroup[], parsed: ParsedSearchQuery, limit: number): SearchGroup[] {
    const deduped = new Map<string, SearchResult>();
    for (const group of groups) {
      for (const rawResult of group.results) {
        const result = {
          ...rawResult,
          source: rawResult.source ?? 'database',
        };
        if (!resultMatchesAdvancedQuery(result, parsed)) continue;
        const key = `${result.entityType}:${result.id}`;
        if (!deduped.has(key)) deduped.set(key, result);
      }
    }
    const results = [...deduped.values()].sort((a, b) => this.compareResults(a, b, parsed));
    return groupSearchResults(results).map((group) => ({
      ...group,
      results: group.results.slice(0, limit),
      count: Math.min(group.count, limit),
    }));
  }

  private compareResults(a: SearchResult, b: SearchResult, parsed: ParsedSearchQuery): number {
    if (parsed.sort === 'title') return a.title.localeCompare(b.title);
    if (parsed.sort === 'recent') {
      return String(b.metadata?.updatedAt ?? '').localeCompare(String(a.metadata?.updatedAt ?? ''));
    }
    const scoreA = a.score ?? this.scoreResult(a, parsed);
    const scoreB = b.score ?? this.scoreResult(b, parsed);
    return scoreB - scoreA || a.title.localeCompare(b.title);
  }

  private scoreResult(result: SearchResult, parsed: ParsedSearchQuery): number {
    const title = normalizeSearchText(result.title);
    const subtitle = normalizeSearchText(result.subtitle ?? '');
    const detail = normalizeSearchText(result.detail ?? '');
    let score = 0;
    for (const token of [...parsed.tokens, ...parsed.arabicTokens]) {
      if (title.includes(token)) score += 5;
      if (subtitle.includes(token)) score += 3;
      if (detail.includes(token)) score += 1;
    }
    return score;
  }

  private mergeFacets(local: ReturnType<typeof facetSearchResults>, external: ReturnType<typeof facetSearchResults>) {
    const byKey = new Map<string, Map<string, number>>();
    for (const facet of [...local, ...external]) {
      const bucket = byKey.get(facet.key) ?? new Map<string, number>();
      for (const value of facet.values) bucket.set(value.value, (bucket.get(value.value) ?? 0) + value.count);
      byKey.set(facet.key, bucket);
    }
    return [...byKey.entries()].map(([key, values]) => ({
      key,
      values: [...values.entries()]
        .map(([value, count]) => ({ value, count }))
        .sort((a, b) => b.count - a.count || a.value.localeCompare(b.value)),
    }));
  }

  private async searchIndexRecords(
    user: AuthUser,
    parsed: ParsedSearchQuery,
    limit: number,
    scope: EffectiveScope,
    granted: string[],
  ): Promise<SearchGroup[]> {
    const client = this.searchIndexClient();
    if (!client) return [];
    const where: Record<string, unknown> = { isDeleted: false };
    if (parsed.normalizedText) {
      where.OR = [
        { title: this.contains(parsed.freeText || parsed.normalizedText) },
        { subtitle: this.contains(parsed.freeText || parsed.normalizedText) },
        { keywords: this.contains(parsed.freeText || parsed.normalizedText) },
        { normalizedKeywords: this.contains(parsed.normalizedText) },
        ...parsed.arabicTokens.map((token) => ({ normalizedKeywords: this.contains(token) })),
      ];
    }
    const rows = await client.findMany({
      where,
      orderBy: parsed.sort === 'title' ? { title: 'asc' } : { lastIndexedAt: 'desc' },
      take: limit * 10,
    });
    const results = rows
      .map((row: any) => this.indexRecordToResult(row))
      .filter((result: SearchResult) => resultMatchesAdvancedQuery(result, parsed))
      .filter((result: SearchResult) =>
        resultPassesDls(result, scope, user, granted, (permissions, required) =>
          this.access.hasPermission(permissions, required),
        ),
      )
      .slice(0, limit * 4);
    return groupSearchResults(results);
  }

  private indexRecordToResult(row: any): SearchResult {
    const metadata = (row.indexedPayloadJson && typeof row.indexedPayloadJson === 'object')
      ? row.indexedPayloadJson as Record<string, unknown>
      : {};
    return {
      id: row.entityId,
      entityType: row.entityType,
      title: row.title,
      subtitle: row.subtitle,
      detail: typeof metadata.detail === 'string' ? metadata.detail : null,
      status: typeof metadata.status === 'string' ? metadata.status : null,
      route: this.parseStoredRoute(row.route),
      source: row.source ?? 'search_index',
      permission: row.permission ?? null,
      metadata,
      visibility: (row.visibilityJson ?? {}) as Record<string, unknown>,
    };
  }

  private parseStoredRoute(route: string): { path: string; queryParams?: Record<string, string> } {
    if (!route) return { path: '/dashboard' };
    try {
      const parsed = JSON.parse(route);
      if (parsed?.path) return parsed;
    } catch {}
    return { path: route };
  }

  private searchIndexClient(): any | null {
    const client = (this.prisma as unknown as { searchIndexRecord?: any }).searchIndexRecord;
    return client?.findMany ? client : null;
  }

  private hasSearchIndexClient(): boolean {
    return !!this.searchIndexClient();
  }

  private searchCdcClient(): any | null {
    const client = (this.prisma as unknown as { searchIndexChangeEvent?: any }).searchIndexChangeEvent;
    return client?.findMany ? client : null;
  }

  private hasSearchCdcClient(): boolean {
    return !!this.searchCdcClient();
  }

  private async enqueueIndexChange(
    entityType: string,
    entityId: string,
    operation: 'upsert' | 'delete',
    payload?: Partial<SearchIndexUpsert>,
  ): Promise<void> {
    const client = this.searchCdcClient();
    if (!client?.create) return;
    await client.create({
      data: {
        entityType,
        entityId,
        operation,
        payloadJson: this.jsonValue(payload ?? null),
        visibilityJson: this.jsonValue(payload?.visibility ?? null),
        status: 'queued',
      },
    });
  }

  private async upsertIndexRecords(records: SearchIndexUpsert[], cdcEventId: string) {
    const client = this.searchIndexClient();
    if (!client) return { localIndexed: 0, externalIndexed: 0, skipped: true };
    let localIndexed = 0;
    const now = new Date();
    for (const record of records) {
      const keywords = buildSearchKeywords([
        record.entityType,
        record.title,
        record.subtitle,
        record.detail,
        record.status,
        record.permission,
        ...Object.values(record.metadata ?? {}).map((value) => value == null ? '' : String(value)),
      ]);
      const payload = {
        ...(record.metadata ?? {}),
        detail: record.detail ?? null,
        status: record.status ?? null,
        updatedAt: now.toISOString(),
      };
      const data = {
        entityType: record.entityType,
        entityId: record.entityId,
        title: record.title,
        subtitle: record.subtitle ?? null,
        keywords,
        normalizedKeywords: keywords,
        route: JSON.stringify(record.route),
        permission: record.permission ?? null,
        source: record.source ?? 'database',
        externalSystem: record.externalSystem ?? null,
        indexedPayloadJson: this.jsonValue(payload) as Prisma.InputJsonObject,
        visibilityJson: this.jsonValue(record.visibility ?? null),
        contentHash: this.contentHash(record),
        lastCdcEventId: cdcEventId,
        isDeleted: false,
        lastIndexedAt: now,
      };
      await client.upsert({
        where: { entityType_entityId: { entityType: record.entityType, entityId: record.entityId } },
        create: data,
        update: { ...data, version: { increment: 1 } },
      });
      localIndexed++;
    }
    const external = await createExternalSearchEngineFromEnv().index(records.map((record) => this.indexUpsertToResult(record)));
    return { localIndexed, externalIndexed: external.indexed, skipped: false, externalStatus: external.status, externalMessage: external.message };
  }

  private async buildCoreIndexRecords(): Promise<SearchIndexUpsert[]> {
    const [
      assets,
      workflowCases,
      dqIssues,
      people,
      roles,
      ndiSpecs,
      openData,
      foiRequests,
      integrations,
      domains,
      orgUnits,
      systems,
      capabilities,
    ] = await Promise.all([
      this.prisma.dataAsset.findMany({
        where: { deletedAt: null },
        select: {
          id: true, code: true, nameEn: true, nameAr: true, description: true, ownerName: true, lifecycleStatus: true,
          domainId: true, orgUnitId: true,
          domain: refSelect, orgUnit: refSelect, classification: { select: { id: true, code: true, nameEn: true, rank: true } },
        },
        take: 500,
      }),
      this.prisma.workflowCase.findMany({
        select: {
          id: true, code: true, title: true, description: true, type: true, status: true, assetId: true,
          asset: { select: { domainId: true, orgUnitId: true, classification: { select: { rank: true } }, code: true, nameEn: true } },
        },
        take: 500,
      }),
      this.prisma.dataQualityIssue.findMany({
        where: { deletedAt: null },
        select: {
          id: true, code: true, title: true, description: true, severity: true, status: true, dimension: true, createdBy: true, assetId: true,
          asset: { select: { code: true, nameEn: true, domainId: true, orgUnitId: true, classification: { select: { rank: true } } } },
        },
        take: 500,
      }),
      this.prisma.person.findMany({
        where: { deletedAt: null },
        select: { id: true, fullNameEn: true, fullNameAr: true, email: true, jobTitle: true, organization: true, isActive: true },
        take: 500,
      }),
      this.prisma.role.findMany({
        where: { deletedAt: null },
        select: { id: true, code: true, nameEn: true, nameAr: true, description: true, isActive: true, isSystem: true },
        take: 500,
      }),
      this.prisma.ndiSpecification.findMany({
        where: { deletedAt: null, isActive: true },
        select: { id: true, code: true, nameEn: true, nameAr: true, descriptionEn: true, criterion: true, type: true, maturityLevel: true, domain: { select: { nameEn: true } } },
        take: 500,
      }),
      this.prisma.openDataCandidate.findMany({
        where: { deletedAt: null },
        select: {
          id: true, code: true, titleEn: true, titleAr: true, description: true, status: true, eligibilityScore: true, assetId: true,
          asset: { select: { code: true, nameEn: true, domainId: true, orgUnitId: true, classification: { select: { rank: true } } } },
        },
        take: 500,
      }),
      this.prisma.foiRequest.findMany({
        where: { deletedAt: null },
        select: {
          id: true, requestNumber: true, subject: true, description: true, status: true, requesterName: true, assetId: true, dataDomainId: true,
          classification: { select: { rank: true, code: true, nameEn: true } },
          asset: { select: { code: true, nameEn: true, domainId: true, orgUnitId: true, classification: { select: { rank: true } } } },
        },
        take: 500,
      }),
      this.prisma.integrationConnector.findMany({
        where: { deletedAt: null },
        select: { id: true, code: true, nameEn: true, nameAr: true, description: true, type: true, status: true, sourceTrust: true, isActive: true },
        take: 500,
      }),
      this.prisma.dataDomain.findMany({
        where: { deletedAt: null },
        select: { id: true, code: true, nameEn: true, nameAr: true, description: true, isActive: true },
        take: 500,
      }),
      this.prisma.organizationUnit.findMany({
        where: { deletedAt: null },
        select: { id: true, code: true, nameEn: true, nameAr: true, isActive: true },
        take: 500,
      }),
      this.prisma.systemPlatform.findMany({
        where: { deletedAt: null },
        select: { id: true, code: true, nameEn: true, nameAr: true, description: true, type: true, vendor: true, isActive: true },
        take: 500,
      }),
      this.prisma.businessCapability.findMany({
        where: { deletedAt: null },
        select: { id: true, code: true, nameEn: true, nameAr: true, description: true, isActive: true },
        take: 500,
      }),
    ]);

    return [
      ...assets.map((row) => ({
        entityType: 'asset',
        entityId: row.id,
        title: row.nameEn,
        subtitle: row.code,
        detail: row.ownerName ?? row.domain?.nameEn ?? row.classification?.nameEn ?? null,
        status: row.lifecycleStatus,
        route: { path: '/assets', queryParams: { assetId: row.id } },
        permission: 'data_assets.view',
        metadata: { nameAr: row.nameAr, description: row.description, domain: row.domain?.nameEn, orgUnit: row.orgUnit?.nameEn, classification: row.classification?.nameEn },
        visibility: { permission: 'data_assets.view', assetId: row.id, domainId: row.domainId, orgUnitId: row.orgUnitId, classificationRank: row.classification?.rank ?? null },
      })),
      ...workflowCases.map((row) => ({
        entityType: 'workflow_case',
        entityId: row.id,
        title: row.title,
        subtitle: row.code,
        detail: row.asset ? `${row.asset.code} - ${row.asset.nameEn}` : row.type,
        status: row.status,
        route: { path: `/governance/workflow/cases/${row.id}` },
        permission: 'workflow_cases.view',
        metadata: { description: row.description, type: row.type },
        visibility: { permission: 'workflow_cases.view', assetId: row.assetId, domainId: row.asset?.domainId, orgUnitId: row.asset?.orgUnitId, classificationRank: row.asset?.classification?.rank ?? null },
      })),
      ...dqIssues.map((row) => ({
        entityType: 'data_quality_issue',
        entityId: row.id,
        title: row.title,
        subtitle: row.code,
        detail: row.asset ? `${row.asset.code} - ${row.asset.nameEn}` : row.severity,
        status: row.status,
        route: { path: '/governance/data-quality', queryParams: { issueId: row.id } },
        permission: 'data_quality_issues.view',
        metadata: { description: row.description, severity: row.severity, dimension: row.dimension },
        visibility: { permission: 'data_quality_issues.view', assetId: row.assetId, domainId: row.asset?.domainId, orgUnitId: row.asset?.orgUnitId, classificationRank: row.asset?.classification?.rank ?? null, createdBy: row.createdBy },
      })),
      ...people.map((row) => ({
        entityType: 'person',
        entityId: row.id,
        title: row.fullNameEn,
        subtitle: row.email,
        detail: row.jobTitle ?? row.organization ?? null,
        status: row.isActive ? 'active' : 'inactive',
        route: { path: '/admin/people' },
        permission: 'people.view',
        metadata: { nameAr: row.fullNameAr, organization: row.organization },
        visibility: { permission: 'people.view' },
      })),
      ...roles.map((row) => ({
        entityType: 'role',
        entityId: row.id,
        title: row.nameEn,
        subtitle: row.code,
        detail: row.description,
        status: row.isSystem ? 'system' : row.isActive ? 'active' : 'inactive',
        route: { path: '/admin/roles' },
        permission: 'roles.view',
        metadata: { nameAr: row.nameAr },
        visibility: { permission: 'roles.view' },
      })),
      ...ndiSpecs.map((row) => ({
        entityType: 'ndi_specification',
        entityId: row.id,
        title: row.nameEn,
        subtitle: row.code,
        detail: row.domain.nameEn,
        status: `${row.type} / ${row.maturityLevel}`,
        route: { path: `/governance/ndi/specifications/${row.id}` },
        permission: 'ndi_specifications.view',
        metadata: { nameAr: row.nameAr, description: row.descriptionEn, criterion: row.criterion },
        visibility: { permission: 'ndi_specifications.view' },
      })),
      ...openData.map((row) => ({
        entityType: 'open_data_candidate',
        entityId: row.id,
        title: row.titleEn,
        subtitle: row.code,
        detail: `${row.asset.code} - ${row.asset.nameEn}`,
        status: `${row.status} / ${row.eligibilityScore}%`,
        route: { path: `/governance/open-data/${row.id}` },
        permission: 'open_data_candidates.view',
        metadata: { titleAr: row.titleAr, description: row.description },
        visibility: { permission: 'open_data_candidates.view', assetId: row.assetId, domainId: row.asset.domainId, orgUnitId: row.asset.orgUnitId, classificationRank: row.asset.classification?.rank ?? null },
      })),
      ...foiRequests.map((row) => ({
        entityType: 'foi_request',
        entityId: row.id,
        title: row.subject,
        subtitle: row.requestNumber,
        detail: row.asset ? `${row.asset.code} - ${row.asset.nameEn}` : row.requesterName,
        status: row.status,
        route: { path: `/governance/foi/${row.id}` },
        permission: 'foi_requests.view',
        metadata: { description: row.description, classification: row.classification?.nameEn },
        visibility: { permission: 'foi_requests.view', assetId: row.assetId, domainId: row.asset?.domainId ?? row.dataDomainId, orgUnitId: row.asset?.orgUnitId, classificationRank: row.asset?.classification?.rank ?? row.classification?.rank ?? null },
      })),
      ...integrations.map((row) => ({
        entityType: 'integration_connector',
        entityId: row.id,
        title: row.nameEn,
        subtitle: row.code,
        detail: `${row.type} / ${row.sourceTrust}`,
        status: row.status,
        route: { path: '/admin/integrations' },
        permission: 'integrations.view',
        metadata: { nameAr: row.nameAr, description: row.description },
        visibility: { permission: 'integrations.view' },
      })),
      ...domains.map((row) => this.referenceIndexRecord(row, 'data_domain', '/admin/data-domains', 'data_domains.view', { domainId: row.id })),
      ...orgUnits.map((row) => this.referenceIndexRecord(row, 'org_unit', '/admin/org-units', 'org_units.view', { orgUnitId: row.id })),
      ...systems.map((row) => this.referenceIndexRecord(row, 'system', '/admin/systems', 'systems.view', { vendor: row.vendor, type: row.type, description: row.description })),
      ...capabilities.map((row) => this.referenceIndexRecord(row, 'business_capability', '/admin/capabilities', 'business_capabilities.view', { description: row.description })),
    ];
  }

  private referenceIndexRecord(
    row: { id: string; code: string; nameEn: string; nameAr?: string | null; isActive: boolean },
    entityType: string,
    path: string,
    permission: string,
    metadata: Record<string, unknown> = {},
  ): SearchIndexUpsert {
    return {
      entityType,
      entityId: row.id,
      title: row.nameEn,
      subtitle: row.code,
      status: row.isActive ? 'active' : 'inactive',
      route: { path },
      permission,
      metadata: { ...metadata, nameAr: row.nameAr },
      visibility: { permission, domainId: metadata.domainId as string | undefined, orgUnitId: metadata.orgUnitId as string | undefined },
    };
  }

  private indexUpsertToResult(record: SearchIndexUpsert): SearchResult {
    return {
      id: record.entityId,
      entityType: record.entityType,
      title: record.title,
      subtitle: record.subtitle,
      detail: record.detail,
      status: record.status,
      route: record.route,
      source: record.source ?? 'database',
      permission: record.permission,
      metadata: record.metadata,
      visibility: record.visibility as Record<string, unknown>,
    };
  }

  private contentHash(record: SearchIndexUpsert): string {
    return createHash('sha256').update(JSON.stringify(record)).digest('hex');
  }

  private jsonValue(value: unknown): Prisma.InputJsonValue {
    if (value == null) return Prisma.JsonNull as unknown as Prisma.InputJsonValue;
    return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
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

  private isUnrestricted(scope: EffectiveScope): boolean {
    return scope.orgUnits === 'all' && scope.domains === 'all' && scope.maxClassRank == null;
  }

  private async actorPersonId(user: Pick<AuthUser, 'id' | 'email'>): Promise<string | null> {
    const person = await this.prisma.person.findFirst({
      where: {
        deletedAt: null,
        isActive: true,
        OR: [{ userId: user.id }, { email: user.email }],
      },
      select: { id: true },
    });
    return person?.id ?? null;
  }

  private async ndiSpecVisibilityWhere(
    scope: EffectiveScope,
    user: AuthUser,
  ): Promise<Prisma.NdiSpecificationWhereInput> {
    if (this.isUnrestricted(scope)) return { deletedAt: null, isActive: true };
    const personId = await this.actorPersonId(user);
    const visible: Prisma.NdiSpecificationWhereInput[] = [
      {
        evidence: {
          some: {
            deletedAt: null,
            OR: [{ submittedBy: user.email }, { reviewedBy: user.email }],
          },
        },
      },
    ];
    if (personId) visible.push({ ownerPersonId: personId });
    return {
      deletedAt: null,
      isActive: true,
      OR: visible,
    };
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

  private dataQualityIssueScopeWhere(
    assetIds: Set<string> | 'all',
    user: Pick<AuthUser, 'email'>,
  ): Prisma.DataQualityIssueWhereInput {
    if (assetIds === 'all') return {};
    const or: Prisma.DataQualityIssueWhereInput[] = [];
    if (assetIds.size > 0) or.push({ assetId: { in: [...assetIds] } });
    or.push({ AND: [{ assetId: null }, { createdBy: user.email }] });
    return { OR: or };
  }

  private foiScopeWhere(
    scope: EffectiveScope,
    assetIds: Set<string> | 'all',
  ): Prisma.FoiRequestWhereInput {
    if (assetIds === 'all') return {};
    const or: Prisma.FoiRequestWhereInput[] = [];
    if (assetIds.size > 0) or.push({ assetId: { in: [...assetIds] } });
    if (scope.orgUnits === 'all' && scope.maxClassRank == null && scope.domains !== 'all') {
      or.push({ AND: [{ assetId: null }, { dataDomainId: { in: scope.domains } }] });
    }
    return or.length ? { OR: or } : { id: { equals: '__no_visible_records__' } };
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
        domainId: true,
        orgUnitId: true,
        domain: refSelect,
        classification: { select: { code: true, nameEn: true, nameAr: true, rank: true } },
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
        source: 'database',
        permission: 'data_assets.view',
        metadata: { domain: row.domain?.nameEn, classification: row.classification?.nameEn },
        visibility: { permission: 'data_assets.view', assetId: row.id, domainId: row.domainId, orgUnitId: row.orgUnitId, classificationRank: row.classification?.rank ?? null },
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
        source: 'database',
        permission: 'people.view',
        visibility: { permission: 'people.view' },
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
        source: 'database',
        permission: 'roles.view',
        visibility: { permission: 'roles.view' },
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
      select: {
        id: true,
        code: true,
        title: true,
        type: true,
        status: true,
        assetId: true,
        asset: { select: { code: true, nameEn: true, domainId: true, orgUnitId: true, classification: { select: { rank: true } } } },
      },
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
        source: 'database',
        permission: 'workflow_cases.view',
        metadata: { type: row.type },
        visibility: { permission: 'workflow_cases.view', assetId: row.assetId, domainId: row.asset?.domainId, orgUnitId: row.asset?.orgUnitId, classificationRank: row.asset?.classification?.rank ?? null },
      })),
    );
  }

  private async searchNdi(
    query: string,
    limit: number,
    scope: EffectiveScope,
    user: AuthUser,
  ): Promise<SearchGroup | null> {
    // Static QA contract: global search NDI remains scoped through this.searchNdi(query, limit, scope, user).
    const rows = await this.prisma.ndiSpecification.findMany({
      where: {
        AND: [
          await this.ndiSpecVisibilityWhere(scope, user),
          {
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
        source: 'database',
        permission: 'ndi_specifications.view',
        visibility: { permission: 'ndi_specifications.view' },
      })),
    );
  }

  private async searchDataQuality(
    query: string,
    limit: number,
    assetIds: Set<string> | 'all',
    user: AuthUser,
  ): Promise<SearchGroup | null> {
    const rows = await this.prisma.dataQualityIssue.findMany({
      where: {
        AND: [
          { deletedAt: null },
          this.dataQualityIssueScopeWhere(assetIds, user),
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
        assetId: true,
        createdBy: true,
        asset: { select: { code: true, nameEn: true, domainId: true, orgUnitId: true, classification: { select: { rank: true } } } },
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
        source: 'database',
        permission: 'data_quality_issues.view',
        metadata: { severity: row.severity },
        visibility: { permission: 'data_quality_issues.view', assetId: row.assetId, domainId: row.asset?.domainId, orgUnitId: row.asset?.orgUnitId, classificationRank: row.asset?.classification?.rank ?? null, createdBy: row.createdBy },
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
        assetId: true,
        asset: { select: { code: true, nameEn: true, domainId: true, orgUnitId: true, classification: { select: { rank: true } } } },
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
        source: 'database',
        permission: 'open_data_candidates.view',
        visibility: { permission: 'open_data_candidates.view', assetId: row.assetId, domainId: row.asset.domainId, orgUnitId: row.asset.orgUnitId, classificationRank: row.asset.classification?.rank ?? null },
      })),
    );
  }

  private async searchFoi(
    query: string,
    limit: number,
    scope: EffectiveScope,
    assetIds: Set<string> | 'all',
  ): Promise<SearchGroup | null> {
    const rows = await this.prisma.foiRequest.findMany({
      where: {
        AND: [
          { deletedAt: null },
          this.foiScopeWhere(scope, assetIds),
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
        assetId: true,
        dataDomainId: true,
        classification: { select: { rank: true, nameEn: true } },
        asset: { select: { code: true, nameEn: true, domainId: true, orgUnitId: true, classification: { select: { rank: true } } } },
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
        source: 'database',
        permission: 'foi_requests.view',
        metadata: { dueAt: row.dueAt.toISOString(), classification: row.classification?.nameEn },
        visibility: { permission: 'foi_requests.view', assetId: row.assetId, domainId: row.asset?.domainId ?? row.dataDomainId, orgUnitId: row.asset?.orgUnitId, classificationRank: row.asset?.classification?.rank ?? row.classification?.rank ?? null },
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
        source: 'database',
        permission: 'integrations.view',
        visibility: { permission: 'integrations.view' },
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
      source: 'database',
      permission: `${entityType === 'data_domain' ? 'data_domains' : entityType === 'org_unit' ? 'org_units' : entityType === 'system' ? 'systems' : 'business_capabilities'}.view`,
      visibility: { permission: `${entityType === 'data_domain' ? 'data_domains' : entityType === 'org_unit' ? 'org_units' : entityType === 'system' ? 'systems' : 'business_capabilities'}.view` },
    };
  }
}

function registryRow(
  code: string,
  entityType: string,
  nameEn: string,
  routeTemplate: string,
  permission: string,
  fields: string[],
  rankWeight: number,
) {
  return {
    code,
    entityType,
    nameEn,
    routeTemplate,
    permission,
    fieldsJson: { fields },
    rankWeight,
    indexStrategy: 'database',
    includeInAutocomplete: true,
    isActive: true,
  };
}
