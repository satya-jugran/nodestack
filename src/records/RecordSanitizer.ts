import { CollectionModel } from '../schema/models/Collection';

const SENSITIVE_AUTH_FIELDS = new Set([
  'passwordHash',
  'password_hash',
  'tokenKey',
  'token_key',
  'password',
  'resetToken',
  'reset_token',
  'verificationToken',
  'verification_token',
  'totpSecret',
  'totp_secret',
  'twoFactorSecret',
  'two_factor_secret',
  'backupCodes',
  'backup_codes',
  'recoveryCodes',
  'recovery_codes',
  'securityAnswers',
  'security_answers',
  'internalNotes',
  'internal_notes',
  'failedLoginAttempts',
  'failed_login_attempts',
]);

export class RecordSanitizer {
  public static sanitize(
    raw: Record<string, any>,
    col: CollectionModel,
    auth?: any,
    isOwner = false
  ): Record<string, any> {
    const clean = { ...raw };

    // Format booleans and parse JSON fields
    if (col.schema) {
      for (const field of col.schema) {
        if (field.type === 'bool' && clean[field.name] !== undefined) {
          clean[field.name] = Boolean(clean[field.name]);
        }
        if (field.type === 'json' && typeof clean[field.name] === 'string') {
          try {
            clean[field.name] = JSON.parse(clean[field.name]);
          } catch {
            // keep as string
          }
        }
        if ((field as any).hidden || (field as any).private || field.options?.private || field.options?.hidden) {
          delete clean[field.name];
        }
      }
    }

    // Hide auth internal and sensitive fields
    if (col.type === 'auth') {
      for (const field of SENSITIVE_AUTH_FIELDS) {
        delete clean[field];
      }
      clean.verified = Boolean(clean.verified);
      clean.emailVisibility = Boolean(clean.emailVisibility);

      // If emailVisibility is false and not owner or admin, mask email
      const isRecordOwner = isOwner || Boolean(auth?.id && clean.id && auth.id === clean.id);
      const isAdmin = Boolean(auth?.isAdmin);

      if (!clean.emailVisibility && !isRecordOwner && !isAdmin) {
        delete clean.email;
      }
    }

    return clean;
  }
}
