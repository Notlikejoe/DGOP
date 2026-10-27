export interface AuthUser {
  id: string;
  email: string;
  roles: string[];
  /** Actual role identities stay in roles; this is responsibility metadata, never grants. */
  businessRoles?: { roleCode: string; businessRoleCode: string }[];
}

export interface JwtPayload {
  sub: string;
  email: string;
  roles: string[];
  tokenVersion: number;
}
