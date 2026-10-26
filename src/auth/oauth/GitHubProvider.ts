import { BaseOAuthProvider } from './BaseOAuthProvider';
import { OAuthProfile, OAuthProviderConfig } from './types';
import { AppError } from '../../core/errors/AppError';

export class GitHubProvider extends BaseOAuthProvider {
  constructor(config: Partial<OAuthProviderConfig> & { clientId: string; clientSecret: string }) {
    super({
      name: 'github',
      displayName: 'GitHub',
      authUrl: 'https://github.com/login/oauth/authorize',
      tokenUrl: 'https://github.com/login/oauth/access_token',
      userinfoUrl: 'https://api.github.com/user',
      scopes: ['read:user', 'user:email'],
      ...config,
    });
  }

  protected async fetchUserProfile(accessToken: string, _tokenData?: any): Promise<OAuthProfile> {
    const userRes = await fetch(this.userinfoUrl, {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'User-Agent': 'NodeStack-OAuth',
        Accept: 'application/json',
      },
    });

    if (!userRes.ok) {
      throw new AppError(`Failed to fetch GitHub user profile: ${userRes.statusText}`, 400);
    }

    const userData = (await userRes.json()) as any;
    let email = userData.email;
    let isEmailVerified = false;

    // If email is null (private profile), fetch user emails list
    if (!email) {
      try {
        const emailsRes = await fetch('https://api.github.com/user/emails', {
          headers: {
            Authorization: `Bearer ${accessToken}`,
            'User-Agent': 'NodeStack-OAuth',
            Accept: 'application/json',
          },
        });
        if (emailsRes.ok) {
          const emails = (await emailsRes.json()) as any[];
          if (Array.isArray(emails)) {
            const primary = emails.find((e) => e.primary && e.verified) || emails.find((e) => e.verified) || emails[0];
            if (primary) {
              email = primary.email;
              isEmailVerified = Boolean(primary.verified);
            }
          }
        }
      } catch {}
    } else {
      isEmailVerified = true;
    }

    return {
      id: String(userData.id),
      email: (email || '').toLowerCase().trim(),
      name: userData.name || userData.login || undefined,
      avatarUrl: userData.avatar_url || undefined,
      isEmailVerified,
      rawUser: userData,
    };
  }
}
