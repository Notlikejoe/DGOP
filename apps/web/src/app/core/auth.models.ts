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
  accessToken: string;
  user: UserProfile;
}

export interface AdminUser {
  id: string;
  email: string;
  displayName: string;
  isActive: boolean;
  lastLoginAt: string | null;
  createdAt: string;
  roles: RoleRef[];
}
