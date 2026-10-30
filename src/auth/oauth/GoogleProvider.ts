import { BaseOAuthProvider } from './BaseOAuthProvider';
import { OAuthProfile, OAuthProviderConfig } from './types';
import { AppError } from '../../core/errors/AppError';

export class GoogleProvider extends BaseOAuthProvider {
  constructor(config: Partial<OAuthProviderConfig> & { clientId: string; clientSecret: string }) {
    super({
      name: 'google',
      displayName: 'Google',
      authUrl: 'https://accounts.google.com/o/oauth2/v2/auth',
      tokenUrl: 'https://oauth2.googleapis.com/token',
      userinfoUrl: 'https://openidconnect.googleapis.com/v1/userinfo',
      scopes: ['openid', 'email', 'profile'],
      ...config,
    });
  }

  public override buildAuthUrl(state: string, codeChallenge: string, redirectUri?: string): string {
    const url = super.buildAuthUrl(state, codeChallenge, redirectUri);
    return `${url}&access_type=offline&prompt=consent`;
  }

  protected async fetchUserProfile(accessToken: string, _tokenData?: any): Promise<OAuthProfile> {
    const res = await fetch(this.userinfoUrl, {
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
      signal: this.getTimeoutSignal(),
    });

    if (!res.ok) {
      throw new AppError(`Failed to fetch Google user profile: ${res.statusText}`, 400);
    }

    const data = (await res.json()) as any;
    return {
      id: String(data.sub || data.id),
      email: (data.email || '').toLowerCase().trim(),
      name: data.name || `${data.given_name || ''} ${data.family_name || ''}`.trim() || undefined,
      avatarUrl: data.picture || undefined,
      isEmailVerified: Boolean(data.email_verified),
      rawUser: data,
    };
  }
}
