import { BaseOAuthProvider } from './BaseOAuthProvider';
import { OAuthProfile, OAuthProviderConfig } from './types';
import { AppError } from '../../core/errors/AppError';

export interface GitHubProviderConfig extends Partial<OAuthProviderConfig> {
  clientId: string;
  clientSecret: string;
  emailsUrl?: string;
}

export class GitHubProvider extends BaseOAuthProvider {
  private emailsUrl: string;

  constructor(config: GitHubProviderConfig) {
    super({
      name: 'github',
      displayName: 'GitHub',
      authUrl: 'https://github.com/login/oauth/authorize',
      tokenUrl: 'https://github.com/login/oauth/access_token',
      userinfoUrl: 'https://api.github.com/user',
      scopes: ['read:user', 'user:email'],
      ...config,
    });
    this.emailsUrl = config.emailsUrl || 'https://api.github.com/user/emails';
  }

  protected override async fetchUserProfile(accessToken: string, _tokenData?: any): Promise<OAuthProfile> {
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
    let email: string | undefined = userData.email;
    let isEmailVerified = false;

    // Consult GitHub's /user/emails endpoint to verify email ownership and verification metadata
    try {
      const emailsRes = await fetch(this.emailsUrl, {
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'User-Agent': 'NodeStack-OAuth',
          Accept: 'application/json',
        },
      });

      if (emailsRes.ok) {
        const emails = (await emailsRes.json()) as any[];
        if (Array.isArray(emails) && emails.length > 0) {
          // 1. Prefer primary verified email
          const primaryVerified = emails.find((e) => e.primary && e.verified);
          if (primaryVerified) {
            email = primaryVerified.email;
            isEmailVerified = true;
          } else {
            // 2. Check if public profile email matches a verified entry in the account's emails
            const matchingEntry = email
              ? emails.find((e) => String(e.email).toLowerCase() === String(email).toLowerCase())
              : undefined;

            if (matchingEntry) {
              isEmailVerified = Boolean(matchingEntry.verified);
            } else {
              // 3. Fallback to any verified email in the account
              const anyVerified = emails.find((e) => e.verified);
              if (anyVerified) {
                email = anyVerified.email;
                isEmailVerified = true;
              } else {
                // Public profile email is not verified in /user/emails
                isEmailVerified = false;
              }
            }
          }
        }
      }
    } catch {
      // If /user/emails request fails, fail-closed: leave isEmailVerified as false
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
