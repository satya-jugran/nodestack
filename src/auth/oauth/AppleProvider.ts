import * as crypto from 'crypto';
import * as jwt from 'jsonwebtoken';
import { BaseOAuthProvider } from './BaseOAuthProvider';
import { OAuthProfile, OAuthProviderConfig } from './types';
import { AppError } from '../../core/errors/AppError';

export interface AppleProviderConfig extends Partial<OAuthProviderConfig> {
  clientId: string;
  clientSecret: string;
  jwksUrl?: string;
  expectedIssuer?: string;
  customKeys?: Array<{ kid: string; [key: string]: any }>;
}

export class AppleProvider extends BaseOAuthProvider {
  private jwksUrl: string;
  private expectedIssuer: string;
  private customKeys?: Array<{ kid: string; [key: string]: any }>;
  private jwksCache: { keys: any[]; expiresAt: number } | null = null;

  constructor(config: AppleProviderConfig) {
    super({
      name: 'apple',
      displayName: 'Apple',
      authUrl: 'https://appleid.apple.com/auth/authorize',
      tokenUrl: 'https://appleid.apple.com/auth/token',
      userinfoUrl: '',
      scopes: ['name', 'email'],
      ...config,
    });

    this.jwksUrl = config.jwksUrl || 'https://appleid.apple.com/auth/keys';
    this.expectedIssuer = config.expectedIssuer || 'https://appleid.apple.com';
    this.customKeys = config.customKeys;
  }

  public override buildAuthUrl(state: string, codeChallenge: string, redirectUri?: string): string {
    const url = super.buildAuthUrl(state, codeChallenge, redirectUri);
    return `${url}&response_mode=query`;
  }

  protected override async fetchUserProfile(_accessToken: string, tokenData?: any): Promise<OAuthProfile> {
    if (!tokenData || !tokenData.id_token) {
      throw new AppError('Apple authorization did not return an id_token', 400);
    }

    const idToken = String(tokenData.id_token);
    const parts = idToken.split('.');
    if (parts.length !== 3) {
      throw new AppError('Malformed Apple id_token JWT', 400);
    }

    // 1. Decode header to extract kid and alg
    let header: { kid?: string; alg?: string };
    try {
      header = JSON.parse(Buffer.from(parts[0], 'base64url').toString('utf8'));
    } catch {
      throw new AppError('Failed to parse Apple id_token header', 400);
    }

    if (!header.kid) {
      throw new AppError('Apple id_token header is missing kid claim', 400);
    }

    if (header.alg !== 'RS256') {
      throw new AppError(`Unsupported Apple id_token algorithm: ${header.alg}`, 400);
    }

    // 2. Retrieve Apple signing key corresponding to kid
    const signingKey = await this.getSigningKey(header.kid);
    if (!signingKey) {
      throw new AppError(`Apple public signing key not found for kid: ${header.kid}`, 400);
    }

    let publicKey: crypto.KeyObject;
    try {
      publicKey = crypto.createPublicKey({ key: signingKey, format: 'jwk' });
    } catch (err: any) {
      throw new AppError(`Failed to import Apple public key: ${err?.message || err}`, 500);
    }

    // 3. Cryptographically verify JWS signature, issuer, audience, and expiry
    let payload: any;
    try {
      payload = jwt.verify(idToken, publicKey, {
        algorithms: ['RS256'],
        issuer: this.expectedIssuer,
        audience: this.clientId,
      });
    } catch (err: any) {
      throw new AppError(`Apple id_token verification failed: ${err?.message || err}`, 400);
    }

    // 4. Validate required claims
    if (!payload.sub || typeof payload.sub !== 'string') {
      throw new AppError('Apple id_token is missing sub claim', 400);
    }

    if (tokenData.nonce && payload.nonce && payload.nonce !== tokenData.nonce) {
      throw new AppError('Apple id_token nonce mismatch', 400);
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

  private async getSigningKey(kid: string): Promise<any> {
    if (this.customKeys && this.customKeys.length > 0) {
      return this.customKeys.find((k) => k.kid === kid);
    }

    // Check cache
    if (this.jwksCache && Date.now() < this.jwksCache.expiresAt) {
      const cached = this.jwksCache.keys.find((k) => k.kid === kid);
      if (cached) return cached;
    }

    // Fetch JWKS
    try {
      const res = await fetch(this.jwksUrl);
      if (!res.ok) {
        throw new Error(`HTTP ${res.status}`);
      }
      const data = (await res.json()) as any;
      if (!data || !Array.isArray(data.keys)) {
        throw new Error('Invalid JWKS JSON structure');
      }

      this.jwksCache = {
        keys: data.keys,
        expiresAt: Date.now() + 3600 * 1000, // cache for 1 hour
      };

      return this.jwksCache.keys.find((k) => k.kid === kid);
    } catch (err: any) {
      throw new AppError(`Failed to fetch Apple public keys from ${this.jwksUrl}: ${err?.message || err}`, 500);
    }
  }
}
