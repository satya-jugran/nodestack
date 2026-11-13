import * as crypto from 'crypto';
import {
  IOAuthProvider,
  OAuthExchangeResult,
  OAuthProfile,
  OAuthProviderConfig,
  GetAuthorizationUrlOptions,
  OAuthAuthorizationUrlResult,
  HandleCallbackOptions,
  OAuthStateSession,
  OAuthStateCookieInfo,
  OAuthStateCookieOptions,
} from './types';
import { AppError } from '../../core/errors/AppError';

export class AuthorizationUrlResult implements OAuthAuthorizationUrlResult {
  public readonly url: string;
  public readonly state: string;
  public readonly codeVerifier: string;
  public readonly codeChallenge: string;
  public readonly cookieHeader: string;
  public readonly cookie: OAuthStateCookieInfo;

  constructor(
    url: string,
    state: string,
    codeVerifier: string,
    codeChallenge: string,
    cookieHeader: string,
    cookie: OAuthStateCookieInfo
  ) {
    this.url = url;
    this.state = state;
    this.codeVerifier = codeVerifier;
    this.codeChallenge = codeChallenge;
    this.cookieHeader = cookieHeader;
    this.cookie = cookie;
  }

  public toString(): string {
    return this.url;
  }

  public valueOf(): string {
    return this.url;
  }

  [Symbol.toPrimitive](hint: string) {
    if (hint === 'number') return NaN;
    return this.url;
  }
}

export abstract class BaseOAuthProvider implements IOAuthProvider {
  public readonly name: string;
  public readonly displayName: string;
  public readonly enabled: boolean;
  public readonly timeoutMs: number;
  protected clientId: string;
  protected clientSecret: string;
  protected authUrl: string;
  protected tokenUrl: string;
  protected userinfoUrl: string;
  protected scopes: string[];
  protected defaultRedirectUri?: string;

  protected stateStore: Map<string, OAuthStateSession> = new Map();
  private static sharedStateStore: Map<string, OAuthStateSession> = new Map();

  constructor(config: OAuthProviderConfig) {
    this.name = config.name;
    this.displayName = config.displayName;
    this.enabled = config.enabled !== false;
    this.clientId = config.clientId;
    this.clientSecret = config.clientSecret;
    this.authUrl = config.authUrl || '';
    this.tokenUrl = config.tokenUrl || '';
    this.userinfoUrl = config.userinfoUrl || '';
    this.scopes = config.scopes || [];
    this.defaultRedirectUri = config.redirectUri;
    this.timeoutMs = config.timeoutMs ?? 10000;
  }

  protected getTimeoutSignal(): AbortSignal {
    return AbortSignal.timeout(this.timeoutMs);
  }

  public buildAuthUrl(state: string, codeChallenge: string, redirectUri?: string): string {
    const uri = redirectUri || this.defaultRedirectUri || '';
    const params = new URLSearchParams({
      client_id: this.clientId,
      response_type: 'code',
      redirect_uri: uri,
      scope: this.scopes.join(' '),
      state,
      code_challenge: codeChallenge,
      code_challenge_method: 'S256',
    });

    return `${this.authUrl}?${params.toString()}`;
  }

  /**
   * Generates a cryptographically secure state parameter and PKCE challenge,
   * stores the session server-side with a 10-minute TTL, provides an HTTP-only
   * cookie header, and constructs the provider authorization URL.
   */
  public getAuthorizationUrl(
    optionsOrRedirectUri?: string | GetAuthorizationUrlOptions,
    options?: GetAuthorizationUrlOptions
  ): OAuthAuthorizationUrlResult {
    this.cleanExpiredStates();

    let redirectUri: string | undefined;
    let opts: GetAuthorizationUrlOptions = {};

    if (typeof optionsOrRedirectUri === 'string') {
      redirectUri = optionsOrRedirectUri;
      opts = options || {};
    } else if (optionsOrRedirectUri && typeof optionsOrRedirectUri === 'object') {
      opts = optionsOrRedirectUri;
      redirectUri = opts.redirectUri;
    }

    const state = opts.state || crypto.randomBytes(16).toString('hex');
    const codeVerifier = opts.codeVerifier || crypto.randomBytes(32).toString('hex');
    const codeChallenge = crypto
      .createHash('sha256')
      .update(codeVerifier)
      .digest('base64url');

    const effectiveRedirectUri = redirectUri || this.defaultRedirectUri || '';
    const cookie = BaseOAuthProvider.createStateCookie(state, opts.cookieOptions, this.name);

    const session: OAuthStateSession = {
      state,
      provider: this.name.toLowerCase(),
      collection: opts.collectionName?.toLowerCase() || 'users',
      codeChallenge,
      codeVerifier,
      redirectUri: effectiveRedirectUri,
      cookieState: state,
      expiresAt: Date.now() + 10 * 60 * 1000,
      createdAt: Date.now(),
    };

    this.saveStateSession(session);

    const url = this.buildAuthUrl(state, codeChallenge, effectiveRedirectUri);

    return new AuthorizationUrlResult(
      url,
      state,
      codeVerifier,
      codeChallenge,
      cookie.header,
      cookie
    );
  }

  /**
   * Validates the callback state against the server-side session and optional HTTP-only cookie,
   * consumes the state immediately to prevent replay and login-CSRF attacks, asserts PKCE code_verifier,
   * and exchanges the authorization code for tokens and user profile.
   */
  public async handleCallback(
    optionsOrCode: string | HandleCallbackOptions | any,
    state?: string,
    codeVerifier?: string,
    redirectUri?: string,
    cookieState?: string
  ): Promise<OAuthExchangeResult> {
    let code: string | undefined;
    let callbackState: string | undefined;
    let verifier: string | undefined;
    let effectiveRedirectUri: string | undefined;
    let expectedCookieState: string | undefined = cookieState;

    if (typeof optionsOrCode === 'string') {
      code = optionsOrCode;
      callbackState = state;
      verifier = codeVerifier;
      effectiveRedirectUri = redirectUri;
    } else if (optionsOrCode && typeof optionsOrCode === 'object') {
      const opts = optionsOrCode;
      if (opts.query || opts.body || opts.headers) {
        // Request-like object (e.g. Fastify or Express request)
        code = opts.query?.code || opts.body?.code;
        callbackState = opts.query?.state || opts.body?.state;
        verifier = opts.query?.codeVerifier || opts.body?.codeVerifier;
        effectiveRedirectUri = opts.query?.redirectUri || opts.body?.redirectUri;
        const cookieHeader = (opts.headers as any)?.cookie || opts.rawCookies;
        if (cookieHeader) {
          const parsed = BaseOAuthProvider.parseCookieHeader(cookieHeader);
          expectedCookieState =
            parsed[`oauth_state_${this.name.toLowerCase()}`] ||
            parsed['oauth_state'];
        }
      } else {
        code = opts.code;
        callbackState = opts.state;
        verifier = opts.codeVerifier;
        effectiveRedirectUri = opts.redirectUri;
        expectedCookieState = opts.cookieState;
        if (!expectedCookieState && opts.rawCookies) {
          const parsed = BaseOAuthProvider.parseCookieHeader(opts.rawCookies);
          expectedCookieState =
            parsed[`oauth_state_${this.name.toLowerCase()}`] ||
            parsed['oauth_state'];
        }
        if (opts.req) {
          const cookieHeader = (opts.req.headers as any)?.cookie;
          if (cookieHeader && !expectedCookieState) {
            const parsed = BaseOAuthProvider.parseCookieHeader(cookieHeader);
            expectedCookieState =
              parsed[`oauth_state_${this.name.toLowerCase()}`] ||
              parsed['oauth_state'];
          }
        }
      }
    }

    if (!code || typeof code !== 'string') {
      throw new AppError('OAuth callback is missing authorization code', 400);
    }

    if (!callbackState || typeof callbackState !== 'string') {
      throw new AppError('OAuth callback is missing state parameter (CSRF protection required)', 400);
    }

    // 1. If an HTTP-only cookie state was provided or detected in the request, assert it matches incoming state
    if (expectedCookieState && expectedCookieState !== callbackState) {
      throw new AppError(
        'OAuth state parameter does not match session cookie: potential CSRF attack detected',
        400
      );
    }

    // 2. Look up the server-side stored session
    const session = this.getStateSession(callbackState);
    if (!session) {
      throw new AppError('Invalid or expired OAuth state parameter', 400);
    }

    // 3. Immediately consume the state session to prevent replay attacks
    this.consumeStateSession(callbackState);

    // 4. Validate session expiration
    if (Date.now() > session.expiresAt) {
      throw new AppError('OAuth authorization session has expired', 400);
    }

    // 5. Validate provider binding
    if (session.provider && session.provider.toLowerCase() !== this.name.toLowerCase()) {
      throw new AppError(
        `OAuth state provider mismatch: expected '${session.provider}', got '${this.name.toLowerCase()}'`,
        400
      );
    }

    // 6. Validate redirect_uri binding if both present
    if (session.redirectUri && effectiveRedirectUri && session.redirectUri !== effectiveRedirectUri) {
      throw new AppError(
        `OAuth state redirect_uri mismatch: expected '${session.redirectUri}', got '${effectiveRedirectUri}'`,
        400
      );
    }

    // 7. Validate PKCE code_verifier challenge
    const finalVerifier = verifier || session.codeVerifier;
    if (session.codeChallenge) {
      if (!finalVerifier) {
        throw new AppError('PKCE code_verifier is required', 400);
      }
      const challenge = crypto.createHash('sha256').update(finalVerifier).digest('base64url');
      if (challenge !== session.codeChallenge) {
        throw new AppError('PKCE code_verifier does not match the session code_challenge', 400);
      }
    }

    // 8. Safely exchange the authorization code for tokens and user profile
    return this.exchangeCode(code, finalVerifier || '', effectiveRedirectUri || session.redirectUri);
  }

  public async exchangeCode(
    code: string,
    codeVerifier: string,
    redirectUri?: string
  ): Promise<OAuthExchangeResult> {
    const uri = redirectUri || this.defaultRedirectUri || '';
    const bodyParams = new URLSearchParams({
      grant_type: 'authorization_code',
      client_id: this.clientId,
      client_secret: this.clientSecret,
      code,
      code_verifier: codeVerifier,
      redirect_uri: uri,
    });

    const tokenRes = await fetch(this.tokenUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Accept: 'application/json',
      },
      body: bodyParams.toString(),
      signal: this.getTimeoutSignal(),
    });

    if (!tokenRes.ok) {
      const errText = await tokenRes.text();
      throw new AppError(`Failed to exchange OAuth code with ${this.displayName}: ${errText}`, 400);
    }

    const tokenData = (await tokenRes.json()) as any;
    const accessToken = tokenData.access_token || tokenData.accessToken;
    if (!accessToken) {
      throw new AppError(`No access token returned by ${this.displayName}`, 400);
    }

    const profile = await this.fetchUserProfile(accessToken, tokenData);

    return {
      accessToken,
      idToken: tokenData.id_token,
      refreshToken: tokenData.refresh_token,
      expiresIn: tokenData.expires_in,
      profile,
    };
  }

  public saveStateSession(session: OAuthStateSession): void {
    this.cleanExpiredStates();
    this.stateStore.set(session.state, session);
    BaseOAuthProvider.sharedStateStore.set(session.state, session);
  }

  public getStateSession(state: string): OAuthStateSession | undefined {
    this.cleanExpiredStates();
    return this.stateStore.get(state) || BaseOAuthProvider.sharedStateStore.get(state);
  }

  public consumeStateSession(state: string): boolean {
    const local = this.stateStore.delete(state);
    const shared = BaseOAuthProvider.sharedStateStore.delete(state);
    return local || shared;
  }

  public cleanExpiredStates(): void {
    const now = Date.now();
    for (const [key, session] of this.stateStore.entries()) {
      if (now > session.expiresAt) {
        this.stateStore.delete(key);
      }
    }
    BaseOAuthProvider.cleanGlobalExpiredStates();
  }

  public static saveGlobalStateSession(session: OAuthStateSession): void {
    BaseOAuthProvider.cleanGlobalExpiredStates();
    BaseOAuthProvider.sharedStateStore.set(session.state, session);
  }

  public static getGlobalStateSession(state: string): OAuthStateSession | undefined {
    BaseOAuthProvider.cleanGlobalExpiredStates();
    return BaseOAuthProvider.sharedStateStore.get(state);
  }

  public static consumeGlobalStateSession(state: string): boolean {
    return BaseOAuthProvider.sharedStateStore.delete(state);
  }

  public static cleanGlobalExpiredStates(): void {
    const now = Date.now();
    for (const [key, session] of BaseOAuthProvider.sharedStateStore.entries()) {
      if (now > session.expiresAt) {
        BaseOAuthProvider.sharedStateStore.delete(key);
      }
    }
  }

  public static createStateCookie(
    state: string,
    options?: OAuthStateCookieOptions,
    providerName = 'default'
  ): OAuthStateCookieInfo {
    const name = options?.name || `oauth_state_${providerName.toLowerCase()}`;
    const path = options?.path || '/';
    const httpOnly = options?.httpOnly !== false;
    const secure = Boolean(options?.secure);
    const sameSite = options?.sameSite || 'lax';
    const maxAge = options?.maxAge ?? 600;

    let header = `${name}=${encodeURIComponent(state)}; Path=${path}; Max-Age=${maxAge}; SameSite=${sameSite.charAt(0).toUpperCase() + sameSite.slice(1)}`;
    if (httpOnly) header += '; HttpOnly';
    if (secure) header += '; Secure';

    return {
      name,
      value: state,
      header,
      options: {
        path,
        httpOnly,
        secure,
        sameSite,
        maxAge,
      },
    };
  }

  public static parseCookieHeader(cookieHeader: string | undefined): Record<string, string> {
    if (!cookieHeader || typeof cookieHeader !== 'string') return {};
    const cookies: Record<string, string> = {};
    const pairs = cookieHeader.split(';');
    for (const pair of pairs) {
      const idx = pair.indexOf('=');
      if (idx > 0) {
        const key = pair.slice(0, idx).trim();
        const val = pair.slice(idx + 1).trim();
        try {
          cookies[key] = decodeURIComponent(val);
        } catch {
          cookies[key] = val;
        }
      }
    }
    return cookies;
  }

  protected abstract fetchUserProfile(accessToken: string, tokenData?: any): Promise<OAuthProfile>;
}
