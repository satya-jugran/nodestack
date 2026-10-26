import { BaseOAuthProvider } from './BaseOAuthProvider';
import { OAuthProfile, OAuthProviderConfig } from './types';
import { AppError } from '../../core/errors/AppError';

export class MicrosoftProvider extends BaseOAuthProvider {
  constructor(config: Partial<OAuthProviderConfig> & { clientId: string; clientSecret: string }) {
    super({
      name: 'microsoft',
      displayName: 'Microsoft',
      authUrl: 'https://login.microsoftonline.com/common/oauth2/v2.0/authorize',
      tokenUrl: 'https://login.microsoftonline.com/common/oauth2/v2.0/token',
      userinfoUrl: 'https://graph.microsoft.com/v1.0/me',
      scopes: ['openid', 'profile', 'email', 'User.Read'],
      ...config,
    });
  }

  public override buildAuthUrl(state: string, codeChallenge: string, redirectUri?: string): string {
    const url = super.buildAuthUrl(state, codeChallenge, redirectUri);
    return `${url}&prompt=select_account`;
  }

  protected async fetchUserProfile(accessToken: string, _tokenData?: any): Promise<OAuthProfile> {
    const res = await fetch(this.userinfoUrl, {
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    });

    if (!res.ok) {
      throw new AppError(`Failed to fetch Microsoft user profile: ${res.statusText}`, 400);
    }

    const data = (await res.json()) as any;
    const email = data.mail || data.userPrincipalName || '';

    return {
      id: String(data.id),
      email: email.toLowerCase().trim(),
      name: data.displayName || `${data.givenName || ''} ${data.surname || ''}`.trim() || undefined,
      avatarUrl: undefined, // Microsoft Graph photo requires separate stream call
      isEmailVerified: true,
      rawUser: data,
    };
  }
}
