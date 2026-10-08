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
}

export interface LoginResponse {
  accessToken?: string;
  user: UserProfile;
}

export interface AiCapabilities {
  administratorOversight:boolean;
  readMode:'governance'|'audit'|'executive'|'own'|'none';
  permissions:string[];
  screens:Record<'useCases'|'risks'|'review'|'reviewOperations'|'dashboard'|'migration',boolean>;
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
