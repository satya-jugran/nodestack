export interface OAuthProviderConfig {
  name: string;
  displayName: string;
  clientId: string;
  clientSecret: string;
  authUrl?: string;
  tokenUrl?: string;
  userinfoUrl?: string;
  scopes?: string[];
  redirectUri?: string;
  enabled?: boolean;
}

export interface OAuthProfile {
  id: string;
  email: string;
  name?: string;
  avatarUrl?: string;
  rawUser: Record<string, any>;
  isEmailVerified: boolean;
}

export interface OAuthExchangeResult {
  accessToken: string;
  idToken?: string;
  refreshToken?: string;
  expiresIn?: number;
  profile: OAuthProfile;
}

export interface IOAuthProvider {
  readonly name: string;
  readonly displayName: string;
  buildAuthUrl(state: string, codeChallenge: string, redirectUri?: string): string;
  exchangeCode(code: string, codeVerifier: string, redirectUri?: string): Promise<OAuthExchangeResult>;
}

export interface AuthMethodProviderInfo {
  name: string;
  displayName: string;
  state: string;
  codeVerifier: string;
  codeChallenge: string;
  codeChallengeMethod: 'S256';
  authUrl: string;
}

export interface PkceSession {
  state: string;
  provider: string;
  collection: string;
  codeChallenge: string;
  codeVerifier?: string;
  redirectUri?: string;
  expiresAt: number;
}

export interface ExternalAuthModel {
  id: string;
  collection: string;
  recordId: string;
  provider: string;
  providerUserId: string;
  email?: string;
  created: string;
  updated: string;
}
