import { EffectiveScope } from '../access/scope.service';
import { AuthUser } from '../auth/auth.types';
import { SearchFacet, SearchGroup, SearchResult } from './search.types';

export interface ParsedSearchQuery {
  raw: string;
  freeText: string;
  normalizedText: string;
  tokens: string[];
  arabicTokens: string[];
  phrases: string[];
  filters: Record<string, string[]>;
  negativeFilters: Record<string, string[]>;
  excludedTerms: string[];
  sort: 'relevance' | 'recent' | 'title';
  hasStructuredFilters: boolean;
}

export interface SearchVisibility {
  permission?: string | null;
  assetId?: string | null;
  domainId?: string | null;
  orgUnitId?: string | null;
  classificationRank?: number | null;
  ownerEmail?: string | null;
  createdBy?: string | null;
  audienceRoleCodes?: string[] | null;
  public?: boolean | null;
}

const FIELD_ALIASES: Record<string, string> = {
  class: 'classification',
  classification: 'classification',
  domain: 'domain',
  entity: 'type',
  kind: 'type',
  permission: 'permission',
  route: 'route',
  source: 'source',
  status: 'status',
  type: 'type',
};

const ARABIC_DIACRITICS = /[\u064B-\u065F\u0670]/g;
const NON_WORD = /[^\p{L}\p{N}_@./:-]+/gu;
const TOKEN_SPLIT = /\s+/;
const QUOTED_PHRASE = /"([^"]+)"/g;

const ARABIC_PREFIXES = ['وال', 'بال', 'كال', 'فال', 'لل', 'ال', 'و', 'ف', 'ب', 'ك', 'ل'];
const ARABIC_SUFFIXES = ['يات', 'ات', 'ون', 'ين', 'ان', 'ية', 'يه', 'ها', 'هم', 'نا', 'كم', 'ة', 'ه', 'ي'];

export function normalizeArabicText(value: string): string {
  return value
    .replace(ARABIC_DIACRITICS, '')
    .replace(/\u0640/g, '')
    .replace(/[إأآٱا]/g, 'ا')
    .replace(/ى/g, 'ي')
    .replace(/ؤ/g, 'و')
    .replace(/ئ/g, 'ي')
    .replace(/ة/g, 'ه');
}

export function lightStemArabicToken(token: string): string {
  let stem = normalizeArabicText(token);
  for (const prefix of ARABIC_PREFIXES) {
    if (stem.length - prefix.length >= 3 && stem.startsWith(prefix)) {
      stem = stem.slice(prefix.length);
      break;
    }
  }
  for (const suffix of ARABIC_SUFFIXES) {
    if (stem.length - suffix.length >= 3 && stem.endsWith(suffix)) {
      stem = stem.slice(0, -suffix.length);
      break;
    }
  }
  return stem;
}

export function normalizeSearchText(value: string): string {
  return normalizeArabicText(value)
    .toLowerCase()
    .replace(NON_WORD, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function tokenizeSearchText(value: string): string[] {
  return [...new Set(normalizeSearchText(value).split(TOKEN_SPLIT).filter((token) => token.length >= 2))];
}

export function buildSearchKeywords(parts: Array<string | null | undefined>): string {
  const raw = parts.filter(Boolean).join(' ');
  const tokens = tokenizeSearchText(raw);
  const stems = tokens.map((token) => lightStemArabicToken(token)).filter((token) => token.length >= 2);
  return [...new Set([...tokens, ...stems])].join(' ');
}

export function parseAdvancedSearchQuery(rawQuery: string): ParsedSearchQuery {
  const raw = rawQuery.trim();
  const phrases: string[] = [];
  const filters: Record<string, string[]> = {};
  const negativeFilters: Record<string, string[]> = {};
  const excludedTerms: string[] = [];
  let queryWithoutPhrases = raw.replace(QUOTED_PHRASE, (_match, phrase: string) => {
    const trimmed = phrase.trim();
    if (trimmed) phrases.push(trimmed);
    return ' ';
  });

  const freeTerms: string[] = [];
  for (const part of queryWithoutPhrases.split(TOKEN_SPLIT).filter(Boolean)) {
    const isNegative = part.startsWith('-');
    const token = isNegative ? part.slice(1) : part;
    const separator = token.indexOf(':');
    if (separator > 0) {
      const key = FIELD_ALIASES[token.slice(0, separator).toLowerCase()] ?? token.slice(0, separator).toLowerCase();
      const value = token.slice(separator + 1).trim();
      if (!value) continue;
      const bucket = isNegative ? negativeFilters : filters;
      bucket[key] = [...(bucket[key] ?? []), value.toLowerCase()];
      continue;
    }
    if (isNegative) {
      if (token.length >= 2) excludedTerms.push(token);
    } else {
      freeTerms.push(part);
    }
  }

  const sortFilter = filters.sort?.[0];
  const sort = sortFilter === 'recent' || sortFilter === 'title' ? sortFilter : 'relevance';
  delete filters.sort;

  const freeText = [...phrases, ...freeTerms].join(' ').trim();
  const tokens = tokenizeSearchText(freeText);
  const arabicTokens = [...new Set(tokens.map((token) => lightStemArabicToken(token)).filter((token) => token.length >= 2))];
  return {
    raw,
    freeText,
    normalizedText: normalizeSearchText(freeText),
    tokens,
    arabicTokens,
    phrases,
    filters,
    negativeFilters,
    excludedTerms: excludedTerms.map((term) => normalizeSearchText(term)).filter(Boolean),
    sort,
    hasStructuredFilters: Object.keys(filters).length > 0 || Object.keys(negativeFilters).length > 0,
  };
}

export function resultMatchesAdvancedQuery(result: SearchResult, parsed: ParsedSearchQuery): boolean {
  const haystack = normalizeSearchText(
    [result.entityType, result.title, result.subtitle, result.detail, result.status, result.source, result.permission]
      .filter(Boolean)
      .join(' '),
  );
  const metadata = lowerRecord(result.metadata);
  const positive = (key: string, values: string[], candidates: Array<string | null | undefined>) => {
    if (!values.length) return true;
    const normalizedCandidates = candidates.filter(Boolean).map((value) => normalizeSearchText(String(value)));
    return values.some((value) => normalizedCandidates.some((candidate) => candidate.includes(normalizeSearchText(value))));
  };
  if (!positive('type', parsed.filters.type ?? [], [result.entityType, metadata.entitytype])) return false;
  if (!positive('status', parsed.filters.status ?? [], [result.status, metadata.status])) return false;
  if (!positive('source', parsed.filters.source ?? [], [result.source, metadata.source])) return false;
  if (!positive('permission', parsed.filters.permission ?? [], [result.permission, metadata.permission])) return false;
  if (!positive('domain', parsed.filters.domain ?? [], [metadata.domain, metadata.domainid, result.detail])) return false;
  if (!positive('classification', parsed.filters.classification ?? [], [metadata.classification, metadata.classificationid, result.detail])) return false;
  if (!positive('route', parsed.filters.route ?? [], [result.route.path])) return false;

  for (const [key, values] of Object.entries(parsed.negativeFilters)) {
    const candidates = [
      result.entityType,
      result.status,
      result.source,
      result.permission,
      result.route.path,
      metadata[key],
      result.title,
      result.subtitle,
      result.detail,
    ];
    if (!positive(key, values, candidates)) continue;
    return false;
  }
  return !parsed.excludedTerms.some((term) => haystack.includes(term));
}

export function resultPassesDls(
  result: Pick<SearchResult, 'visibility' | 'permission'>,
  scope: EffectiveScope,
  user: Pick<AuthUser, 'email' | 'roles'>,
  grantedPermissions: string[],
  hasPermission: (granted: string[], required: string) => boolean,
): boolean {
  const visibility = result.visibility ?? {};
  const requiredPermission = visibility.permission ?? result.permission;
  if (requiredPermission && !hasPermission(grantedPermissions, requiredPermission)) return false;
  const roleGate = visibility.audienceRoleCodes?.filter(Boolean) ?? [];
  if (roleGate.length && !roleGate.some((role) => user.roles.includes(role))) return false;
  if (visibility.ownerEmail && visibility.ownerEmail === user.email) return true;
  if (visibility.createdBy && visibility.createdBy === user.email) return true;
  if (scope.orgUnits !== 'all' && visibility.orgUnitId && !scope.orgUnits.includes(visibility.orgUnitId)) return false;
  if (scope.domains !== 'all' && visibility.domainId && !scope.domains.includes(visibility.domainId)) return false;
  if (
    scope.maxClassRank != null &&
    visibility.classificationRank != null &&
    visibility.classificationRank > scope.maxClassRank
  ) {
    return false;
  }
  return true;
}

export function facetSearchResults(groups: SearchGroup[]): SearchFacet[] {
  const buckets = {
    entityType: new Map<string, number>(),
    status: new Map<string, number>(),
    source: new Map<string, number>(),
    permission: new Map<string, number>(),
  };
  for (const group of groups) {
    for (const result of group.results) {
      increment(buckets.entityType, result.entityType);
      increment(buckets.status, result.status);
      increment(buckets.source, result.source ?? 'database');
      increment(buckets.permission, result.permission);
    }
  }
  return Object.entries(buckets)
    .map(([key, map]) => ({
      key,
      values: [...map.entries()]
        .map(([value, count]) => ({ value, count }))
        .sort((a, b) => b.count - a.count || a.value.localeCompare(b.value)),
    }))
    .filter((facet) => facet.values.length > 0);
}

export function groupSearchResults(results: SearchResult[]): SearchGroup[] {
  const groups = new Map<string, SearchResult[]>();
  for (const result of results) {
    const type = groupTypeForEntity(result.entityType);
    groups.set(type, [...(groups.get(type) ?? []), result]);
  }
  return [...groups.entries()].map(([type, rows]) => ({ type: type as SearchGroup['type'], count: rows.length, results: rows }));
}

export function groupTypeForEntity(entityType: string): SearchGroup['type'] {
  const normalized = entityType.toLowerCase();
  if (normalized.includes('asset')) return 'assets';
  if (normalized.includes('person') || normalized.includes('people') || normalized.includes('user')) return 'people';
  if (normalized.includes('role')) return 'roles';
  if (normalized.includes('workflow')) return 'workflow';
  if (normalized.includes('ndi')) return 'ndi';
  if (normalized.includes('quality')) return 'dataQuality';
  if (normalized.includes('open_data')) return 'openData';
  if (normalized.includes('foi')) return 'foi';
  if (normalized.includes('integration') || normalized.includes('connector')) return 'integrations';
  return 'reference';
}

function lowerRecord(value: unknown): Record<string, string> {
  if (!value || typeof value !== 'object') return {};
  const out: Record<string, string> = {};
  for (const [key, raw] of Object.entries(value as Record<string, unknown>)) {
    out[key.toLowerCase()] = raw == null ? '' : String(raw).toLowerCase();
  }
  return out;
}

function increment(map: Map<string, number>, raw?: string | null): void {
  const value = raw?.trim();
  if (!value) return;
  map.set(value, (map.get(value) ?? 0) + 1);
}
