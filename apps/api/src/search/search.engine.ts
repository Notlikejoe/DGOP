import { ParsedSearchQuery } from './search.logic';
import { SearchFacet, SearchResult } from './search.types';

export interface ExternalSearchEngineResult {
  results: SearchResult[];
  facets: SearchFacet[];
  diagnostics: {
    backend: 'opensearch' | 'elasticsearch';
    status: 'available' | 'unavailable' | 'skipped';
    message?: string;
  };
}

export interface ExternalSearchEngine {
  readonly backend: 'opensearch' | 'elasticsearch';
  readonly enabled: boolean;
  search(parsed: ParsedSearchQuery, limit: number): Promise<ExternalSearchEngineResult>;
  index(records: SearchResult[]): Promise<{ indexed: number; status: 'available' | 'unavailable' | 'skipped'; message?: string }>;
}

export function createExternalSearchEngineFromEnv(): ExternalSearchEngine {
  const backend = normalizeBackend(process.env.DGOP_SEARCH_BACKEND);
  const endpoint = (process.env.DGOP_SEARCH_ENDPOINT ?? '').replace(/\/+$/, '');
  const indexName = process.env.DGOP_SEARCH_INDEX || 'dgop-search';
  return new HttpSearchEngine(backend, endpoint, indexName);
}

class HttpSearchEngine implements ExternalSearchEngine {
  readonly enabled: boolean;

  constructor(
    readonly backend: 'opensearch' | 'elasticsearch',
    private readonly endpoint: string,
    private readonly indexName: string,
  ) {
    this.enabled = !!endpoint && (backend === 'opensearch' || backend === 'elasticsearch');
  }

  async search(parsed: ParsedSearchQuery, limit: number): Promise<ExternalSearchEngineResult> {
    if (!this.enabled) {
      return {
        results: [],
        facets: [],
        diagnostics: { backend: this.backend, status: 'skipped', message: 'External search endpoint is not configured.' },
      };
    }
    try {
      const body = {
        size: limit,
        query: {
          bool: {
            must: this.buildMust(parsed),
            filter: this.buildFilters(parsed),
            must_not: this.buildMustNot(parsed),
          },
        },
        aggs: {
          entityType: { terms: { field: 'entityType.keyword', size: 20 } },
          status: { terms: { field: 'status.keyword', size: 20 } },
          source: { terms: { field: 'source.keyword', size: 20 } },
          permission: { terms: { field: 'permission.keyword', size: 20 } },
        },
      };
      const response = await fetch(`${this.endpoint}/${encodeURIComponent(this.indexName)}/_search`, {
        method: 'POST',
        headers: this.headers(),
        body: JSON.stringify(body),
      });
      if (!response.ok) {
        return {
          results: [],
          facets: [],
          diagnostics: { backend: this.backend, status: 'unavailable', message: `HTTP ${response.status}` },
        };
      }
      const json = await response.json() as any;
      return {
        results: (json.hits?.hits ?? []).map((hit: any) => this.mapHit(hit)),
        facets: mapExternalFacets(json.aggregations),
        diagnostics: { backend: this.backend, status: 'available' },
      };
    } catch (error) {
      return {
        results: [],
        facets: [],
        diagnostics: {
          backend: this.backend,
          status: 'unavailable',
          message: error instanceof Error ? error.message : 'External search failed.',
        },
      };
    }
  }

  async index(records: SearchResult[]): Promise<{ indexed: number; status: 'available' | 'unavailable' | 'skipped'; message?: string }> {
    if (!this.enabled || records.length === 0) {
      return { indexed: 0, status: this.enabled ? 'available' : 'skipped' };
    }
    try {
      const lines = records.flatMap((record) => [
        JSON.stringify({ index: { _index: this.indexName, _id: `${record.entityType}:${record.id}` } }),
        JSON.stringify(record),
      ]);
      const response = await fetch(`${this.endpoint}/_bulk`, {
        method: 'POST',
        headers: this.headers('application/x-ndjson'),
        body: `${lines.join('\n')}\n`,
      });
      if (!response.ok) return { indexed: 0, status: 'unavailable' as const, message: `HTTP ${response.status}` };
      return { indexed: records.length, status: 'available' as const };
    } catch (error) {
      return {
        indexed: 0,
        status: 'unavailable' as const,
        message: error instanceof Error ? error.message : 'External indexing failed.',
      };
    }
  }

  private buildMust(parsed: ParsedSearchQuery): unknown[] {
    if (!parsed.normalizedText) return [{ match_all: {} }];
    return [
      {
        multi_match: {
          query: parsed.normalizedText,
          fields: ['title^4', 'subtitle^2', 'detail^2', 'keywords^2', 'normalizedKeywords^3'],
          type: parsed.phrases.length ? 'phrase_prefix' : 'best_fields',
          fuzziness: parsed.phrases.length ? undefined : 'AUTO',
        },
      },
    ];
  }

  private buildFilters(parsed: ParsedSearchQuery): unknown[] {
    const filters: unknown[] = [];
    for (const [field, values] of Object.entries(parsed.filters)) {
      if (!['type', 'status', 'source', 'permission'].includes(field)) continue;
      const target = field === 'type' ? 'entityType.keyword' : `${field}.keyword`;
      filters.push({ terms: { [target]: values } });
    }
    return filters;
  }

  private buildMustNot(parsed: ParsedSearchQuery): unknown[] {
    const nots: unknown[] = parsed.excludedTerms.map((term) => ({
      multi_match: { query: term, fields: ['title', 'subtitle', 'detail', 'keywords', 'normalizedKeywords'] },
    }));
    for (const [field, values] of Object.entries(parsed.negativeFilters)) {
      if (!['type', 'status', 'source', 'permission'].includes(field)) continue;
      const target = field === 'type' ? 'entityType.keyword' : `${field}.keyword`;
      nots.push({ terms: { [target]: values } });
    }
    return nots;
  }

  private mapHit(hit: any): SearchResult {
    const source = hit._source ?? {};
    return {
      id: source.id ?? hit._id,
      entityType: source.entityType ?? 'external_record',
      title: source.title ?? 'External record',
      subtitle: source.subtitle ?? null,
      detail: source.detail ?? null,
      status: source.status ?? null,
      route: source.route ?? { path: '/search' },
      source: source.source ?? this.backend,
      permission: source.permission ?? null,
      metadata: source.metadata ?? {},
      visibility: source.visibility ?? {},
    };
  }

  private headers(contentType = 'application/json'): Record<string, string> {
    const headers: Record<string, string> = { 'content-type': contentType };
    if (process.env.DGOP_SEARCH_API_KEY) headers.authorization = `ApiKey ${process.env.DGOP_SEARCH_API_KEY}`;
    if (process.env.DGOP_SEARCH_USERNAME && process.env.DGOP_SEARCH_PASSWORD) {
      headers.authorization = `Basic ${Buffer.from(`${process.env.DGOP_SEARCH_USERNAME}:${process.env.DGOP_SEARCH_PASSWORD}`).toString('base64')}`;
    }
    return headers;
  }
}

function normalizeBackend(value?: string): 'opensearch' | 'elasticsearch' {
  return value?.toLowerCase() === 'elasticsearch' ? 'elasticsearch' : 'opensearch';
}

function mapExternalFacets(aggregations: any): SearchFacet[] {
  if (!aggregations || typeof aggregations !== 'object') return [];
  return Object.entries(aggregations).map(([key, value]: [string, any]) => ({
    key,
    values: (value.buckets ?? []).map((bucket: any) => ({ value: String(bucket.key), count: Number(bucket.doc_count) || 0 })),
  }));
}
