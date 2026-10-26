import { BaseOAuthProvider } from './BaseOAuthProvider';
import { OAuthProfile, OAuthProviderConfig } from './types';
import { AppError } from '../../core/errors/AppError';

export class AppleProvider extends BaseOAuthProvider {
  constructor(config: Partial<OAuthProviderConfig> & { clientId: string; clientSecret: string }) {
    super({
      name: 'apple',
      displayName: 'Apple',
      authUrl: 'https://appleid.apple.com/auth/authorize',
      tokenUrl: 'https://appleid.apple.com/auth/token',
      userinfoUrl: '',
      scopes: ['name', 'email'],
      ...config,
    });
  }

  public override buildAuthUrl(state: string, codeChallenge: string, redirectUri?: string): string {
    const url = super.buildAuthUrl(state, codeChallenge, redirectUri);
    return `${url}&response_mode=query`;
  }

  protected async fetchUserProfile(_accessToken: string, tokenData?: any): Promise<OAuthProfile> {
    if (!tokenData || !tokenData.id_token) {
      throw new AppError('Apple authorization did not return an id_token', 400);
    }

    // Decode Apple ID Token (JWT) payload
    const parts = tokenData.id_token.split('.');
    if (parts.length < 2) {
      throw new AppError('Malformed Apple id_token JWT', 400);
    }

    let payload: any;
    try {
      const decodedPayload = Buffer.from(parts[1], 'base64url').toString('utf8');
      payload = JSON.parse(decodedPayload);
    } catch {
      throw new AppError('Failed to parse Apple id_token payload', 400);
    }

    const email = (payload.email || '').toLowerCase().trim();
    const isEmailVerified = payload.email_verified === true || payload.email_verified === 'true';

    return {
      id: String(payload.sub),
      email,
      name: undefined,
      avatarUrl: undefined,
      isEmailVerified,
      rawUser: payload,
    };
  }
}
