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

  protected override async fetchUserProfile(accessToken: string, tokenData?: any): Promise<OAuthProfile> {
    const res = await fetch(this.userinfoUrl, {
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
      signal: this.getTimeoutSignal(),
    });

    if (!res.ok) {
      throw new AppError(`Failed to fetch Microsoft user profile: ${res.statusText}`, 400);
    }

    const data = (await res.json()) as any;

    // 1. Extract id_token claims if returned in tokenData
    let idTokenClaims: Record<string, any> | undefined;
    if (tokenData && tokenData.id_token) {
      try {
        const parts = String(tokenData.id_token).split('.');
        if (parts.length >= 2) {
          idTokenClaims = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'));
        }
      } catch {
        // Non-fatal if id_token parsing fails
      }
    }

    // 2. Resolve email address: prefer verified email claim, mail, or userPrincipalName
    const email = (
      idTokenClaims?.email ||
      data.mail ||
      idTokenClaims?.preferred_username ||
      data.userPrincipalName ||
      ''
    ).toLowerCase().trim();

    // 3. Resolve email verification assertion
    // Neither mail nor userPrincipalName is an email-verification assertion.
    // Require an explicit verification assertion from id_token or profile metadata.
    let isEmailVerified = false;

    if (data.email_verified === true || data.email_verified === 'true') {
      isEmailVerified = true;
    } else if (idTokenClaims) {
      if (idTokenClaims.email_verified === true || idTokenClaims.email_verified === 'true') {
        isEmailVerified = true;
      } else if (
        (idTokenClaims.xms_edov === '1' || idTokenClaims.xms_edov === 1) &&
        email &&
        (idTokenClaims.email || idTokenClaims.preferred_username)
      ) {
        // xms_edov indicates email domain owner verified in Microsoft Entra ID
        isEmailVerified = true;
      }
    }

    return {
      id: String(data.id || idTokenClaims?.sub || idTokenClaims?.oid),
      email,
      name: data.displayName || `${data.givenName || ''} ${data.surname || ''}`.trim() || idTokenClaims?.name || undefined,
      avatarUrl: undefined, // Microsoft Graph photo requires separate stream call
      isEmailVerified,
      rawUser: {
        ...data,
        ...(idTokenClaims ? { _idTokenClaims: idTokenClaims } : {}),
      },
    };
  }
}
