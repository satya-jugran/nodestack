export class AppError extends Error {
  public readonly statusCode: number;
  public readonly data?: Record<string, any>;

  constructor(message: string, statusCode = 400, data?: Record<string, any>) {
    super(message);
    this.name = this.constructor.name;
    this.statusCode = statusCode;
    this.data = data;
    Error.captureStackTrace(this, this.constructor);
  }
}

export class NotFoundError extends AppError {
  constructor(message = 'Resource not found', data?: Record<string, any>) {
    super(message, 404, data);
  }
}

export class UnauthorizedError extends AppError {
  constructor(message = 'Unauthorized request', data?: Record<string, any>) {
    super(message, 401, data);
  }
}

export class ForbiddenError extends AppError {
  constructor(message = 'Access denied: insufficient permissions', data?: Record<string, any>) {
    super(message, 403, data);
  }
}

export class ValidationError extends AppError {
  constructor(message = 'Validation failed', data?: Record<string, any>) {
    super(message, 422, data);
  }
}

export class ConflictError extends AppError {
  constructor(message = 'Resource already exists', data?: Record<string, any>) {
    super(message, 409, data);
  }
}
