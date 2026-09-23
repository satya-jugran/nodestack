import { BaseService } from './BaseService';

export interface FileUrlOptions {
  download?: boolean;
  token?: string | boolean;
  collection?: string;
}

/**
 * Service for generating file URLs for assets uploaded to NodeStack.
 */
export class FileService extends BaseService {
  /**
   * Generates a fully qualified URL to an uploaded file.
   *
   * @param record - Record object or record ID string
   * @param filename - Name of the file stored on the record
   * @param options - Additional options (download flag, auth token, collection override)
   */
  public getUrl(
    record: { id: string; collection?: string; collectionName?: string; [key: string]: any } | string,
    filename: string,
    options: FileUrlOptions = {}
  ): string {
    if (!filename) return '';

    let recordId = '';
    let collectionName = options.collection || '';

    if (typeof record === 'string') {
      recordId = record;
    } else if (record && typeof record === 'object') {
      recordId = record.id || '';
      collectionName =
        collectionName ||
        record.collection ||
        record.collectionName ||
        record['@collectionName'] ||
        '';
    }

    if (!recordId) {
      throw new Error('[FileService] A valid record or recordId is required to construct a file URL.');
    }

    if (!collectionName) {
      throw new Error(
        '[FileService] Collection name is required. Either provide a record with collection info or pass options.collection.'
      );
    }

    const cleanBase = (this.client.baseUrl || '').replace(/\/+$/, '');
    const cleanCol = encodeURIComponent(collectionName);
    const cleanId = encodeURIComponent(recordId);
    const cleanFile = encodeURIComponent(filename);

    let url = `${cleanBase}/api/files/${cleanCol}/${cleanId}/${cleanFile}`;

    const queryParts: string[] = [];

    if (options.download) {
      queryParts.push('download=1');
    }

    // Attach token if requested
    if (typeof options.token === 'string' && options.token) {
      queryParts.push(`token=${encodeURIComponent(options.token)}`);
    } else if (options.token === true && this.client.authStore.token) {
      queryParts.push(`token=${encodeURIComponent(this.client.authStore.token)}`);
    }

    if (queryParts.length > 0) {
      url += `?${queryParts.join('&')}`;
    }

    return url;
  }
}
