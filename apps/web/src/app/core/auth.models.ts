export interface RoleRef {
  code: string;
  nameEn: string;
  nameAr: string;
}

export interface ScopeSummary {
  orgUnits: string[] | 'all';
  domains: string[] | 'all';
  maxClassRank: number | null;
}

export interface UserProfile {
  id: string;
  email: string;
  displayName: string;
  isActive: boolean;
  lastLoginAt: string | null;
  roles: RoleRef[];
  permissions: string[];
  scopes?: ScopeSummary;
  accessRevision?: string;
  aiCapabilities?: AiCapabilities;
}

export interface AiCapabilities {
  administratorOversight: boolean;
  readMode: 'governance' | 'audit' | 'executive' | 'own' | 'none';
  permissions: string[];
  screens: { useCases: boolean; risks: boolean; review: boolean; reviewOperations: boolean; dashboard: boolean; migration: boolean };
  panels?: { triage?: boolean; classification?: boolean; classificationVerification: boolean; specialist?: boolean; decision?: boolean; registration: boolean };
}

export interface LoginResponse {
  accessToken?: string;
  user: UserProfile;
}


export interface AiRegisterPage<T,S> {data:T[];total:number;page:number;pageSize:number;totalPages:number;summary:S;}

export interface AdminUser {
  id: string;
  email: string;
  displayName: string;
  isActive: boolean;
  lastLoginAt: string | null;
  createdAt: string;
  roles: RoleRef[];
}
