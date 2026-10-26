import * as crypto from 'crypto';
import { IOAuthProvider, OAuthProviderConfig, AuthMethodProviderInfo } from './types';
import { GoogleProvider } from './GoogleProvider';
import { GitHubProvider } from './GitHubProvider';
import { DiscordProvider } from './DiscordProvider';
import { MicrosoftProvider } from './MicrosoftProvider';
import { AppleProvider } from './AppleProvider';

export class OAuthProviderRegistry {
  private providers: Map<string, IOAuthProvider> = new Map();

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
   * Generates PKCE challenge and state for each active provider.
   */
  public listAuthMethods(redirectUri?: string): AuthMethodProviderInfo[] {
    const methods: AuthMethodProviderInfo[] = [];

    for (const provider of this.providers.values()) {
      const state = crypto.randomBytes(16).toString('hex');
      const codeVerifier = crypto.randomBytes(32).toString('hex');
      const codeChallenge = crypto
        .createHash('sha256')
        .update(codeVerifier)
        .digest('base64url');

      const authUrl = provider.buildAuthUrl(state, codeChallenge, redirectUri);

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
}
