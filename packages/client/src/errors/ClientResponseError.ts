export interface ClientResponseErrorOptions {
  url?: string;
  status?: number;
  data?: any;
  isAbort?: boolean;
  originalError?: any;
  message?: string;
}

/**
 * Standardized client response error representing failed HTTP requests
 * or network exceptions when interacting with NodeStack.
 */
export class ClientResponseError extends Error {
  public readonly url: string;
  public readonly status: number;
  public readonly data: any;
  public readonly isAbort: boolean;
  public readonly originalError?: any;

  constructor(options: ClientResponseErrorOptions = {}) {
    const status = options.status || 0;
    const message =
      options.message ||
      options.data?.message ||
      (status > 0 ? `NodeStack request failed with status ${status}` : 'NodeStack network request failed');

    super(message);
    this.name = 'ClientResponseError';
    this.url = options.url || '';
    this.status = status;
    this.data = options.data || {};
    this.isAbort = Boolean(options.isAbort);
    this.originalError = options.originalError;

    // Restore prototype chain
    Object.setPrototypeOf(this, ClientResponseError.prototype);
  }

  public toJSON() {
    return {
      name: this.name,
      message: this.message,
      url: this.url,
      status: this.status,
      data: this.data,
      isAbort: this.isAbort,
    };
  }
}
