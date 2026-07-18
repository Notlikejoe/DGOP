export interface AuthUser {
  id: string;
  email: string;
  roles: string[];
}

export interface JwtPayload {
  sub: string;
  email: string;
  roles: string[];
  tokenVersion: number;
}
