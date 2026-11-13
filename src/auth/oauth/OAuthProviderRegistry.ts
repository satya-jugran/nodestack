import * as crypto from 'crypto';
import { IOAuthProvider, OAuthProviderConfig, AuthMethodProviderInfo, PkceSession } from './types';
import { AppError } from '../../core/errors/AppError';
import { BaseOAuthProvider, IOAuthRegistrySessionStore } from './BaseOAuthProvider';
import { GoogleProvider } from './GoogleProvider';
import { GitHubProvider } from './GitHubProvider';
import { DiscordProvider } from './DiscordProvider';
import { MicrosoftProvider } from './MicrosoftProvider';
import { AppleProvider } from './AppleProvider';

export class OAuthProviderRegistry implements IOAuthRegistrySessionStore {
  private providers: Map<string, IOAuthProvider> = new Map();
  private sessions: Map<string, PkceSession> = new Map();
  public readonly appId?: string;
  private unsubscribeStateConsumed?: () => void;

  constructor(customConfigs?: OAuthProviderConfig[], appId?: string) {
    this.appId = appId;
    BaseOAuthProvider.registerRegistry(this);
    this.unsubscribeStateConsumed = BaseOAuthProvider.onStateConsumed((state) => {
      this.sessions.delete(state);
    });
    this.initDefaultProviders(customConfigs);
  }

  public getSession(state: string): PkceSession | undefined {
    return this.sessions.get(state);
  }

  public deleteSession(state: string): boolean {
    return this.sessions.delete(state);
  }

  public setAppId(appId?: string): void {
    (this as any).appId = appId;
  }

  private initDefaultProviders(customConfigs?: OAuthProviderConfig[]): void {
    if (customConfigs && customConfigs.length > 0) {
      for (const cfg of customConfigs) {
        this.registerFromConfig(cfg);
      }
      return;
    }

    // Check environment variables
    const googleId = process.env.OAUTH_GOOGLE_CLIENT_ID;
    const googleSecret = process.env.OAUTH_GOOGLE_CLIENT_SECRET;
    if (googleId && googleSecret) {
      this.register(new GoogleProvider({ clientId: googleId, clientSecret: googleSecret }));
    }

    const githubId = process.env.OAUTH_GITHUB_CLIENT_ID;
    const githubSecret = process.env.OAUTH_GITHUB_CLIENT_SECRET;
    if (githubId && githubSecret) {
      this.register(new GitHubProvider({ clientId: githubId, clientSecret: githubSecret }));
    }

    const discordId = process.env.OAUTH_DISCORD_CLIENT_ID;
    const discordSecret = process.env.OAUTH_DISCORD_CLIENT_SECRET;
    if (discordId && discordSecret) {
      this.register(new DiscordProvider({ clientId: discordId, clientSecret: discordSecret }));
    }

    const msId = process.env.OAUTH_MICROSOFT_CLIENT_ID;
    const msSecret = process.env.OAUTH_MICROSOFT_CLIENT_SECRET;
    if (msId && msSecret) {
      this.register(new MicrosoftProvider({ clientId: msId, clientSecret: msSecret }));
    }

    const appleId = process.env.OAUTH_APPLE_CLIENT_ID;
    const appleSecret = process.env.OAUTH_APPLE_CLIENT_SECRET;
    if (appleId && appleSecret) {
      this.register(new AppleProvider({ clientId: appleId, clientSecret: appleSecret }));
    }
  }

  public register(provider: IOAuthProvider): void {
    if (provider.enabled === false) {
      this.unregister(provider.name);
      return;
    }
    if (provider instanceof BaseOAuthProvider) {
      provider.bindRegistry(this);
    }
    this.providers.set(provider.name.toLowerCase(), provider);
  }

  public unregister(name: string): boolean {
    const provider = this.providers.get(name.toLowerCase());
    if (provider instanceof BaseOAuthProvider) {
      provider.unbindRegistry(this);
    }
    return this.providers.delete(name.toLowerCase());
  }

  public destroy(): void {
    BaseOAuthProvider.unregisterRegistry(this);
    if (this.unsubscribeStateConsumed) {
      this.unsubscribeStateConsumed();
      this.unsubscribeStateConsumed = undefined;
    }
    for (const p of this.providers.values()) {
      if (p instanceof BaseOAuthProvider) {
        p.unbindRegistry(this);
      }
    }
    this.sessions.clear();
  }

  public registerFromConfig(config: OAuthProviderConfig): void {
    if (config.enabled === false) {
      this.unregister(config.name);
      return;
    }

    const name = config.name.toLowerCase();
    switch (name) {
      case 'google':
        this.register(new GoogleProvider(config));
        break;
      case 'github':
        this.register(new GitHubProvider(config));
        break;
      case 'discord':
        this.register(new DiscordProvider(config));
        break;
      case 'microsoft':
        this.register(new MicrosoftProvider(config));
        break;
      case 'apple':
        this.register(new AppleProvider(config));
        break;
      default:
        break;
    }
  }

  public getProvider(name: string): IOAuthProvider | undefined {
    const provider = this.providers.get(name.toLowerCase());
    if (!provider || provider.enabled === false) {
      return undefined;
    }
    return provider;
  }

  public isProviderEnabled(name: string): boolean {
    const provider = this.getProvider(name);
    return Boolean(provider && provider.enabled !== false);
  }

  public getEnabledProviders(): IOAuthProvider[] {
    return Array.from(this.providers.values()).filter((p) => p.enabled !== false);
  }

  /**
   * Generates PKCE challenge and state for each active provider,
   * securely binding the state to a short-lived PKCE transaction session.
   */
  public listAuthMethods(redirectUri?: string, collectionName = 'users'): AuthMethodProviderInfo[] {
    this.cleanExpiredSessions();
    const methods: AuthMethodProviderInfo[] = [];

    for (const provider of this.getEnabledProviders()) {
      const state = crypto.randomBytes(16).toString('hex');
      const codeVerifier = crypto.randomBytes(32).toString('hex');
      const codeChallenge = crypto
        .createHash('sha256')
        .update(codeVerifier)
        .digest('base64url');

      const authUrl = provider.buildAuthUrl(state, codeChallenge, redirectUri);

      // Bind state to short-lived transaction (10 minutes TTL) scoped strictly to this registry / app
      const sessionData: PkceSession = {
        state,
        provider: provider.name.toLowerCase(),
        collection: collectionName.toLowerCase(),
        appId: this.appId,
        codeChallenge,
        codeVerifier,
        redirectUri,
        expiresAt: Date.now() + 10 * 60 * 1000,
      };
      this.sessions.set(state, sessionData);

      // Synchronize session with provider and global store so handleCallback and authenticateOAuth2 share lifecycle
      if (provider instanceof BaseOAuthProvider) {
        provider.saveStateSession({
          ...sessionData,
          createdAt: Date.now(),
        });
      } else {
        BaseOAuthProvider.saveGlobalStateSession({
          ...sessionData,
          createdAt: Date.now(),
        });
      }

      methods.push({
        name: provider.name,
        displayName: provider.displayName,
        state,
        codeVerifier,
        codeChallenge,
        codeChallengeMethod: 'S256',
        authUrl,
      });
    }

    return methods;
  }

  /**
   * Registers a PKCE transaction session (useful for custom flows or test suites).
   */
  public registerSession(session: Partial<PkceSession> & { state: string; provider: string; collection: string; appId?: string }): void {
    const fullSession: PkceSession = {
      state: session.state,
      provider: session.provider.toLowerCase(),
      collection: session.collection.toLowerCase(),
      appId: session.appId || this.appId,
      codeChallenge: session.codeChallenge || '',
      codeVerifier: session.codeVerifier,
      redirectUri: session.redirectUri,
      expiresAt: session.expiresAt || Date.now() + 10 * 60 * 1000,
    };
    this.sessions.set(session.state, fullSession);

    // Keep provider local store and global store synchronized
    const provider = this.getProvider(fullSession.provider);
    if (provider instanceof BaseOAuthProvider) {
      provider.saveStateSession({
        ...fullSession,
        createdAt: Date.now(),
      });
    } else {
      BaseOAuthProvider.saveGlobalStateSession({
        ...fullSession,
        createdAt: Date.now(),
      });
    }
  }

  /**
   * Validates and immediately consumes the OAuth state parameter to prevent login-CSRF and replay attacks.
   */
  public validateAndConsumeState(
    state: string,
    providerName: string,
    collectionName: string,
    codeVerifier?: string,
    redirectUri?: string,
    appId?: string
  ): PkceSession {
    this.cleanExpiredSessions();

    if (!state || typeof state !== 'string') {
      throw new AppError('OAuth state parameter is required', 400);
    }

    const effectiveAppId = appId || this.appId;

    let session = this.sessions.get(state);
    if (!session) {
      // Check global session
      const globalSession = BaseOAuthProvider.getGlobalStateSession(state);
      if (globalSession) {
        const matchesApp = (!effectiveAppId && !globalSession.appId) ||
          (effectiveAppId && globalSession.appId === effectiveAppId);
        if (matchesApp) {
          session = {
            state: globalSession.state,
            provider: globalSession.provider,
            collection: globalSession.collection || collectionName.toLowerCase(),
            appId: globalSession.appId,
            codeChallenge: globalSession.codeChallenge || '',
            codeVerifier: globalSession.codeVerifier,
            redirectUri: globalSession.redirectUri,
            expiresAt: globalSession.expiresAt,
          };
        }
      }
    }

    if (!session) {
      throw new AppError('Invalid or expired OAuth state parameter', 400);
    }

    // Immediately consume across all stores (registry, global, and providers) to prevent replay attacks
    this.sessions.delete(state);
    BaseOAuthProvider.consumeGlobalStateSession(state);
    BaseOAuthProvider.notifyStateConsumed(state);
    for (const p of this.providers.values()) {
      if (p instanceof BaseOAuthProvider) {
        p.consumeLocalState(state);
      }
    }

    if (Date.now() > session.expiresAt) {
      throw new AppError('OAuth authorization session has expired', 400);
    }

    // Strictly validate app identifier binding to prevent cross-app session hijacking
    if (session.appId && effectiveAppId && session.appId !== effectiveAppId) {
      throw new AppError(
        `OAuth state app mismatch: expected '${session.appId}', got '${effectiveAppId}'`,
        400
      );
    }

    if (session.provider !== providerName.toLowerCase()) {
      throw new AppError(
        `OAuth state provider mismatch: expected '${session.provider}', got '${providerName.toLowerCase()}'`,
        400
      );
    }

    if (session.collection !== collectionName.toLowerCase()) {
      throw new AppError(
        `OAuth state collection mismatch: expected '${session.collection}', got '${collectionName.toLowerCase()}'`,
        400
      );
    }

    if (session.redirectUri && redirectUri && session.redirectUri !== redirectUri) {
      throw new AppError(
        `OAuth state redirect_uri mismatch: expected '${session.redirectUri}', got '${redirectUri}'`,
        400
      );
    }

    if (session.codeChallenge) {
      if (!codeVerifier) {
        throw new AppError('PKCE code_verifier is required', 400);
      }
      const computedChallenge = crypto.createHash('sha256').update(codeVerifier).digest('base64url');
      if (computedChallenge !== session.codeChallenge) {
        throw new AppError('PKCE code_verifier does not match the session code_challenge', 400);
      }
    }

    return session;
  }

  private cleanExpiredSessions(): void {
    const now = Date.now();
    for (const [state, session] of this.sessions.entries()) {
      if (now > session.expiresAt) {
        this.sessions.delete(state);
      }
    }
  }
}
