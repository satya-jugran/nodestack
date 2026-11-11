import { CollectionModel } from '../schema/models/Collection';

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
      }
    }

    // Hide auth internal fields
    if (col.type === 'auth') {
      delete clean.passwordHash;
      delete clean.tokenKey;
      delete clean.password;
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
