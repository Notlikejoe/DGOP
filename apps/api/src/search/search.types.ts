export type SearchGroupType =
  | 'assets'
  | 'people'
  | 'roles'
  | 'workflow'
  | 'ndi'
  | 'dataQuality'
  | 'openData'
  | 'foi'
  | 'integrations'
  | 'reference';

export interface SearchRoute {
  path: string;
  queryParams?: Record<string, string>;
}

export interface SearchResult {
  id: string;
  entityType: string;
  title: string;
  subtitle?: string | null;
  detail?: string | null;
  status?: string | null;
  route: SearchRoute;
  source?: string | null;
  permission?: string | null;
  metadata?: Record<string, unknown> | null;
  visibility?: any;
  score?: number | null;
}

export interface SearchGroup {
  type: SearchGroupType;
  count: number;
  results: SearchResult[];
}

export interface SearchFacetValue {
  value: string;
  count: number;
}

export interface SearchFacet {
  key: string;
  values: SearchFacetValue[];
}

export interface GlobalSearchResponse {
  query: string;
  total: number;
  groups: SearchGroup[];
  facets?: SearchFacet[];
  parsed?: {
    terms: string[];
    filters: Record<string, string[]>;
    excludedTerms: string[];
    sort: string;
  };
  engines?: Array<{ name: string; status: 'available' | 'unavailable' | 'skipped'; message?: string }>;
  security?: { dlsApplied: boolean; queryProtected: boolean };
}
