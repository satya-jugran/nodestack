export class AppError extends Error {
  public readonly statusCode: number;
  public readonly data?: Record<string, any>;

  constructor(
    message: string,
    statusCode = 400,
    data?: Record<string, any>,
    options?: ErrorOptions
  ) {
    const errorOptions: ErrorOptions | undefined =
      options || (data && (data as any).cause !== undefined ? { cause: (data as any).cause } : undefined);
    super(message, errorOptions);
    this.name = this.constructor.name;
    this.statusCode = statusCode;
    this.data = data;
    if (errorOptions?.cause && (this as any).cause === undefined) {
      (this as any).cause = errorOptions.cause;
    }
    Error.captureStackTrace(this, this.constructor);
  }
}

export class NotFoundError extends AppError {
  constructor(message = 'Resource not found', data?: Record<string, any>, options?: ErrorOptions) {
    super(message, 404, data, options);
  }
}

export class UnauthorizedError extends AppError {
  constructor(message = 'Unauthorized request', data?: Record<string, any>, options?: ErrorOptions) {
    super(message, 401, data, options);
  }
}

export class ForbiddenError extends AppError {
  constructor(message = 'Access denied: insufficient permissions', data?: Record<string, any>, options?: ErrorOptions) {
    super(message, 403, data, options);
  }
}

export class ValidationError extends AppError {
  constructor(message = 'Validation failed', data?: Record<string, any>, options?: ErrorOptions) {
    super(message, 422, data, options);
  }
}

export class ConflictError extends AppError {
  constructor(message = 'Resource already exists', data?: Record<string, any>, options?: ErrorOptions) {
    super(message, 409, data, options);
  }
}

export class ServiceUnavailableError extends AppError {
  constructor(message = 'Service temporarily unavailable', data?: Record<string, any>, options?: ErrorOptions) {
    super(message, 503, data, options);
  }
}

