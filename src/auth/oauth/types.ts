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
  timeoutMs?: number;
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
  readonly enabled?: boolean;
  buildAuthUrl(state: string, codeChallenge: string, redirectUri?: string, scopes?: string[]): string;
  exchangeCode(code: string, codeVerifier: string, redirectUri?: string): Promise<OAuthExchangeResult>;
  getAuthorizationUrl?(
    optionsOrRedirectUri?: string | GetAuthorizationUrlOptions,
    options?: GetAuthorizationUrlOptions
  ): OAuthAuthorizationUrlResult;
  handleCallback?(
    optionsOrCode: string | HandleCallbackOptions | any,
    state?: string,
    codeVerifier?: string,
    redirectUri?: string,
    cookieState?: string,
    appId?: string,
    collectionName?: string
  ): Promise<OAuthExchangeResult>;
}

export interface OAuthStateCookieOptions {
  name?: string;
  path?: string;
  httpOnly?: boolean;
  secure?: boolean;
  sameSite?: 'lax' | 'strict' | 'none';
  maxAge?: number;
  appId?: string;
}

export interface OAuthStateCookieInfo {
  name: string;
  value: string;
  header: string;
  options: {
    path: string;
    httpOnly: boolean;
    secure: boolean;
    sameSite: 'lax' | 'strict' | 'none';
    maxAge: number;
  };
}

export interface GetAuthorizationUrlOptions {
  redirectUri?: string;
  state?: string;
  codeVerifier?: string;
  scopes?: string[];
  cookieOptions?: OAuthStateCookieOptions;
  collectionName?: string;
  appId?: string;
}

export interface OAuthAuthorizationUrlResult {
  readonly url: string;
  readonly state: string;
  readonly codeVerifier: string;
  readonly codeChallenge: string;
  readonly cookieHeader: string;
  readonly cookie: OAuthStateCookieInfo;
  toString(): string;
  valueOf(): string;
}

export interface HandleCallbackOptions {
  code?: string;
  state?: string;
  codeVerifier?: string;
  redirectUri?: string;
  cookieState?: string;
  rawCookies?: string;
  collectionName?: string;
  collection?: string;
  appId?: string;
  params?: any;
  query?: any;
  body?: any;
  headers?: any;
  req?: any;
}

export interface OAuthStateSession {
  state: string;
  provider: string;
  collection?: string;
  appId?: string;
  codeChallenge?: string;
  codeVerifier?: string;
  redirectUri?: string;
  cookieState?: string;
  scopes?: string[];
  expiresAt: number;
  createdAt: number;
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
  appId?: string;
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
