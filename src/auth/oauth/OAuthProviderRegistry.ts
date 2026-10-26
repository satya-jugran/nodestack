import * as crypto from 'crypto';
import { IOAuthProvider, OAuthProviderConfig, AuthMethodProviderInfo, PkceSession } from './types';
import { AppError } from '../../core/errors/AppError';
import { GoogleProvider } from './GoogleProvider';
import { GitHubProvider } from './GitHubProvider';
import { DiscordProvider } from './DiscordProvider';
import { MicrosoftProvider } from './MicrosoftProvider';
import { AppleProvider } from './AppleProvider';

export class OAuthProviderRegistry {
  private providers: Map<string, IOAuthProvider> = new Map();
  private sessions: Map<string, PkceSession> = new Map();

  constructor(customConfigs?: OAuthProviderConfig[]) {
    this.initDefaultProviders(customConfigs);
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
    this.providers.set(provider.name.toLowerCase(), provider);
  }

  public registerFromConfig(config: OAuthProviderConfig): void {
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
    return this.providers.get(name.toLowerCase());
  }

  public getEnabledProviders(): IOAuthProvider[] {
    return Array.from(this.providers.values());
  }

  /**
   * Generates PKCE challenge and state for each active provider,
   * securely binding the state to a short-lived PKCE transaction session.
   */
  public listAuthMethods(redirectUri?: string, collectionName = 'users'): AuthMethodProviderInfo[] {
    this.cleanExpiredSessions();
    const methods: AuthMethodProviderInfo[] = [];

    for (const provider of this.providers.values()) {
      const state = crypto.randomBytes(16).toString('hex');
      const codeVerifier = crypto.randomBytes(32).toString('hex');
      const codeChallenge = crypto
        .createHash('sha256')
        .update(codeVerifier)
        .digest('base64url');

      const authUrl = provider.buildAuthUrl(state, codeChallenge, redirectUri);

      // Bind state to short-lived transaction (10 minutes TTL)
      this.sessions.set(state, {
        state,
        provider: provider.name.toLowerCase(),
        collection: collectionName.toLowerCase(),
        codeChallenge,
        codeVerifier,
        redirectUri,
        expiresAt: Date.now() + 10 * 60 * 1000,
      });

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
  public registerSession(session: Partial<PkceSession> & { state: string; provider: string; collection: string }): void {
    this.sessions.set(session.state, {
      state: session.state,
      provider: session.provider.toLowerCase(),
      collection: session.collection.toLowerCase(),
      codeChallenge: session.codeChallenge || '',
      codeVerifier: session.codeVerifier,
      redirectUri: session.redirectUri,
      expiresAt: session.expiresAt || Date.now() + 10 * 60 * 1000,
    });
  }

  /**
   * Validates and immediately consumes the OAuth state parameter to prevent login-CSRF and replay attacks.
   */
  public validateAndConsumeState(
    state: string,
    providerName: string,
    collectionName: string,
    codeVerifier?: string,
    redirectUri?: string
  ): PkceSession {
    this.cleanExpiredSessions();

    if (!state || typeof state !== 'string') {
      throw new AppError('OAuth state parameter is required', 400);
    }

    const session = this.sessions.get(state);
    if (!session) {
      throw new AppError('Invalid or expired OAuth state parameter', 400);
    }

    // Immediately consume to prevent replay attacks
    this.sessions.delete(state);

    if (Date.now() > session.expiresAt) {
      throw new AppError('OAuth authorization session has expired', 400);
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
