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
}

export interface SearchGroup {
  type: SearchGroupType;
  count: number;
  results: SearchResult[];
}

export interface GlobalSearchResponse {
  query: string;
  total: number;
  groups: SearchGroup[];
}
