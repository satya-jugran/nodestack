import { BaseOAuthProvider } from './BaseOAuthProvider';
import { OAuthProfile, OAuthProviderConfig } from './types';
import { AppError } from '../../core/errors/AppError';

export class DiscordProvider extends BaseOAuthProvider {
  constructor(config: Partial<OAuthProviderConfig> & { clientId: string; clientSecret: string }) {
    super({
      name: 'discord',
      displayName: 'Discord',
      authUrl: 'https://discord.com/api/oauth2/authorize',
      tokenUrl: 'https://discord.com/api/oauth2/token',
      userinfoUrl: 'https://discord.com/api/users/@me',
      scopes: ['identify', 'email'],
      ...config,
    });
  }

  public override buildAuthUrl(state: string, codeChallenge: string, redirectUri?: string): string {
    const url = super.buildAuthUrl(state, codeChallenge, redirectUri);
    return `${url}&prompt=consent`;
  }

  protected async fetchUserProfile(accessToken: string, _tokenData?: any): Promise<OAuthProfile> {
    const res = await fetch(this.userinfoUrl, {
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
      signal: AbortSignal.timeout(10000),
    });

    if (!res.ok) {
      throw new AppError(`Failed to fetch Discord user profile: ${res.statusText}`, 400);
    }

    const data = (await res.json()) as any;
    let avatarUrl: string | undefined;
    if (data.avatar) {
      avatarUrl = `https://cdn.discordapp.com/avatars/${data.id}/${data.avatar}.png`;
    }

    return {
      id: String(data.id),
      email: (data.email || '').toLowerCase().trim(),
      name: data.global_name || data.username || undefined,
      avatarUrl,
      isEmailVerified: Boolean(data.verified),
      rawUser: data,
    };
  }
}
