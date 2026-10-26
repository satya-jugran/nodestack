import { IOAuthProvider, OAuthExchangeResult, OAuthProfile, OAuthProviderConfig } from './types';
import { AppError } from '../../core/errors/AppError';

export abstract class BaseOAuthProvider implements IOAuthProvider {
  public readonly name: string;
  public readonly displayName: string;
  protected clientId: string;
  protected clientSecret: string;
  protected authUrl: string;
  protected tokenUrl: string;
  protected userinfoUrl: string;
  protected scopes: string[];
  protected defaultRedirectUri?: string;

  constructor(config: OAuthProviderConfig) {
    this.name = config.name;
    this.displayName = config.displayName;
    this.clientId = config.clientId;
    this.clientSecret = config.clientSecret;
    this.authUrl = config.authUrl || '';
    this.tokenUrl = config.tokenUrl || '';
    this.userinfoUrl = config.userinfoUrl || '';
    this.scopes = config.scopes || [];
    this.defaultRedirectUri = config.redirectUri;
  }

  public buildAuthUrl(state: string, codeChallenge: string, redirectUri?: string): string {
    const uri = redirectUri || this.defaultRedirectUri || '';
    const params = new URLSearchParams({
      client_id: this.clientId,
      response_type: 'code',
      redirect_uri: uri,
      scope: this.scopes.join(' '),
      state,
      code_challenge: codeChallenge,
      code_challenge_method: 'S256',
    });

    return `${this.authUrl}?${params.toString()}`;
  }

  public async exchangeCode(
    code: string,
    codeVerifier: string,
    redirectUri?: string
  ): Promise<OAuthExchangeResult> {
    const uri = redirectUri || this.defaultRedirectUri || '';
    const bodyParams = new URLSearchParams({
      grant_type: 'authorization_code',
      client_id: this.clientId,
      client_secret: this.clientSecret,
      code,
      code_verifier: codeVerifier,
      redirect_uri: uri,
    });

    const tokenRes = await fetch(this.tokenUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Accept: 'application/json',
      },
      body: bodyParams.toString(),
    });

    if (!tokenRes.ok) {
      const errText = await tokenRes.text();
      throw new AppError(`Failed to exchange OAuth code with ${this.displayName}: ${errText}`, 400);
    }

    const tokenData = (await tokenRes.json()) as any;
    const accessToken = tokenData.access_token || tokenData.accessToken;
    if (!accessToken) {
      throw new AppError(`No access token returned by ${this.displayName}`, 400);
    }

    const profile = await this.fetchUserProfile(accessToken, tokenData);

    return {
      accessToken,
      idToken: tokenData.id_token,
      refreshToken: tokenData.refresh_token,
      expiresIn: tokenData.expires_in,
      profile,
    };
  }

  protected abstract fetchUserProfile(accessToken: string, tokenData?: any): Promise<OAuthProfile>;
}
