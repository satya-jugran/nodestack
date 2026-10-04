import { FastifyRequest, FastifyReply } from 'fastify';
import { ConfigService } from '../../core/config/ConfigService';

export interface ChaosSimulationConfig {
  enabled?: boolean;
  mockDelay?: number | string;
  mockError?: number | string;
  mockFailRate?: number;
  mockJitter?: number;
  mockErrorMessage?: string;
}

export interface RequestSimulationParams {
  delay?: number;
  errorStatus?: number | 'drop';
  failRate?: number;
  jitter?: number;
  errorMessage?: string;
}

/**
 * ChaosMiddleware simulates real-world mobile network latency, intermittent network drops,
 * and HTTP server errors. This allows frontend developers to test loading spinners,
 * skeleton placeholders, error boundary toasts, and retry logic locally against SQLite.
 */
export class ChaosMiddleware {
  private config: ChaosSimulationConfig;

  constructor(configService?: ConfigService | ChaosSimulationConfig) {
    if (configService && 'mockDelay' in configService) {
      this.config = {
        enabled: true,
        mockDelay: configService.mockDelay,
        mockError: configService.mockError,
        mockFailRate: configService.mockFailRate,
        mockJitter: configService.mockJitter,
        mockErrorMessage: configService.mockErrorMessage,
      };
    } else {
      this.config = {
        enabled: true,
      };
    }
  }

  /**
   * Dynamically update global chaos simulation options at runtime.
   */
  public setOptions(options: Partial<ChaosSimulationConfig>): void {
    this.config = {
      ...this.config,
      ...options,
    };
  }

  /**
   * Get current simulation options.
   */
  public getOptions(): ChaosSimulationConfig {
    return { ...this.config };
  }

  /**
   * Reset simulation options to clean defaults.
   */
  public reset(): void {
    this.config = { enabled: true };
  }

  /**
   * Helper to set delay in milliseconds.
   */
  public setDelay(delayMs?: number | string): void {
    this.config.mockDelay = delayMs;
  }

  /**
   * Helper to set fail rate between 0.0 and 1.0 (or percentage).
   */
  public setFailRate(rate?: number): void {
    this.config.mockFailRate = rate;
  }

  /**
   * Helper to set mock error status code.
   */
  public setError(status?: number | string): void {
    this.config.mockError = status;
  }

  /**
   * Fastify onRequest hook handler.
   */
  public async handle(req: FastifyRequest, reply: FastifyReply): Promise<void> {
    // Never simulate chaos on CORS preflight OPTIONS requests
    if (req.method === 'OPTIONS') {
      return;
    }

    if (this.config.enabled === false) {
      return;
    }

    const params = this.resolveParams(req);
    if (!params) {
      return;
    }

    // 1. Latency Simulation
    if (params.delay && params.delay > 0) {
      reply.header('x-simulated-delay', String(params.delay));
      await this.sleep(params.delay);
    }

    // 2. Chaos / Error Simulation
    const shouldFail = this.shouldFail(params);
    if (shouldFail) {
      // Simulate raw TCP socket drop / connection hangup if requested
      if (params.errorStatus === 'drop') {
        if (req.raw && typeof req.raw.destroy === 'function') {
          req.raw.destroy();
          return;
        }
      }

      const statusCode = typeof params.errorStatus === 'number' ? params.errorStatus : 500;
      const message =
        params.errorMessage ||
        (params.errorStatus && params.errorStatus !== 500
          ? `Simulated chaos error (mock_error=${statusCode})`
          : params.failRate !== undefined
          ? `Simulated network drop (mock_fail_rate=${params.failRate})`
          : `Simulated chaos error (mock_error=${statusCode})`);

      reply.header('x-simulated-chaos', 'true');
      reply.header('x-simulated-error', String(statusCode));
      if (params.failRate !== undefined) {
        reply.header('x-simulated-fail-rate', String(params.failRate));
      }

      // Fastify reply short-circuits route execution
      return reply.status(statusCode).send({
        statusCode,
        message,
        chaos: true,
        data: {
          simulated: true,
          mockError: statusCode,
          mockFailRate: params.failRate,
          mockDelay: params.delay,
        },
      });
    }
  }

  /**
   * Resolves simulation parameters by checking:
   * 1. Query parameters (?mock_delay=1500, ?mock_error=500, ?mock_fail_rate=0.2)
   * 2. Request headers (x-mock-delay: 1500, x-mock-error: 500, x-mock-fail-rate: 0.2)
   * 3. ConfigService / Server global options
   */
  public resolveParams(req: FastifyRequest): RequestSimulationParams | null {
    const query = (req.query as Record<string, any>) || {};
    const headers = req.headers || {};

    // Helper to find first defined value among multiple keys
    const getQueryVal = (...keys: string[]): any => {
      for (const k of keys) {
        if (query[k] !== undefined && query[k] !== null && query[k] !== '') {
          return query[k];
        }
      }
      return undefined;
    };

    const getHeaderVal = (...keys: string[]): any => {
      for (const k of keys) {
        const val = headers[k.toLowerCase()];
        if (val !== undefined && val !== null && val !== '') {
          return val;
        }
      }
      return undefined;
    };

    // Raw values: query overrides header overrides config
    const rawDelay =
      getQueryVal('mock_delay', 'mockDelay', 'mock-delay', 'delay') ??
      getHeaderVal('x-mock-delay', 'mock-delay', 'x-delay') ??
      this.config.mockDelay;

    const rawJitter =
      getQueryVal('mock_jitter', 'mockJitter', 'mock-jitter') ??
      getHeaderVal('x-mock-jitter', 'mock-jitter') ??
      this.config.mockJitter;

    const rawError =
      getQueryVal('mock_error', 'mockError', 'mock-error') ??
      getHeaderVal('x-mock-error', 'mock-error') ??
      this.config.mockError;

    const rawFailRate =
      getQueryVal('mock_fail_rate', 'mockFailRate', 'mock-fail-rate', 'mock_failure_rate', 'mockFailureRate') ??
      getHeaderVal('x-mock-fail-rate', 'mock-fail-rate', 'x-mock-failure-rate', 'mock-failure-rate') ??
      this.config.mockFailRate;

    const rawErrorMessage =
      getQueryVal('mock_error_message', 'mockErrorMessage', 'mock-error-message') ??
      getHeaderVal('x-mock-error-message', 'mock-error-message') ??
      this.config.mockErrorMessage;

    // If nothing is configured or requested on this request, skip
    if (
      rawDelay === undefined &&
      rawError === undefined &&
      rawFailRate === undefined &&
      rawJitter === undefined
    ) {
      return null;
    }

    const jitter = this.parseJitter(rawJitter);
    const delay = this.parseDelay(rawDelay, jitter);
    const errorStatus = this.parseErrorStatus(rawError);
    const failRate = this.parseFailRate(rawFailRate);

    return {
      delay,
      errorStatus,
      failRate,
      jitter,
      errorMessage: rawErrorMessage ? String(rawErrorMessage) : undefined,
    };
  }

  /**
   * Evaluates whether a request should fail based on errorStatus and failRate.
   */
  public shouldFail(params: RequestSimulationParams): boolean {
    if (params.failRate !== undefined) {
      if (params.failRate <= 0) return false;
      if (params.failRate >= 1) return true;
      return Math.random() < params.failRate;
    }

    // If mock_error was explicitly provided without a fail_rate, fail 100% of the time
    if (params.errorStatus !== undefined) {
      return true;
    }

    return false;
  }

  /**
   * Parse delay into milliseconds. Supports:
   * - 1500 or "1500" -> 1500
   * - "1.5s" -> 1500
   * - "500ms" -> 500
   * - "500-1500" or "500..1500" (random range)
   */
  public parseDelay(rawVal: any, jitter = 0): number | undefined {
    if (rawVal === undefined || rawVal === null || rawVal === '') {
      return undefined;
    }

    let delayMs = 0;

    if (typeof rawVal === 'number') {
      delayMs = rawVal;
    } else if (typeof rawVal === 'string') {
      const trimmed = rawVal.trim();

      // Range check: "500-1500" or "500..1500"
      if (trimmed.includes('..') || (trimmed.includes('-') && !trimmed.startsWith('-'))) {
        const parts = trimmed.split(/\.\.|-/).map((p) => p.trim());
        if (parts.length === 2) {
          const min = this.parseSingleDuration(parts[0]);
          const max = this.parseSingleDuration(parts[1]);
          if (!isNaN(min) && !isNaN(max)) {
            const low = Math.min(min, max);
            const high = Math.max(min, max);
            delayMs = Math.round(low + Math.random() * (high - low));
          } else {
            delayMs = this.parseSingleDuration(trimmed);
          }
        } else {
          delayMs = this.parseSingleDuration(trimmed);
        }
      } else {
        delayMs = this.parseSingleDuration(trimmed);
      }
    }

    if (isNaN(delayMs) || delayMs < 0) {
      return undefined;
    }

    // Apply jitter if provided: ±jitter
    if (jitter > 0) {
      const variance = (Math.random() * 2 - 1) * jitter;
      delayMs = Math.round(delayMs + variance);
    }

    // Clamp between 0 and 120,000ms (2 minutes max safety limit)
    return Math.min(120000, Math.max(0, delayMs));
  }

  private parseSingleDuration(str: string): number {
    const trimmed = str.trim().toLowerCase();
    if (trimmed.endsWith('ms')) {
      return parseFloat(trimmed.slice(0, -2));
    }
    if (trimmed.endsWith('s')) {
      return parseFloat(trimmed.slice(0, -1)) * 1000;
    }
    return parseFloat(trimmed);
  }

  public parseJitter(rawVal: any): number {
    if (rawVal === undefined || rawVal === null || rawVal === '') return 0;
    const parsed = typeof rawVal === 'number' ? rawVal : parseFloat(String(rawVal));
    return isNaN(parsed) || parsed < 0 ? 0 : parsed;
  }

  /**
   * Parse fail rate between 0.0 and 1.0. Supports:
   * - 0.2 -> 0.2
   * - "0.2" -> 0.2
   * - "20%" -> 0.2
   * - 20 (interpreted as 20% if > 1)
   */
  public parseFailRate(rawVal: any): number | undefined {
    if (rawVal === undefined || rawVal === null || rawVal === '') {
      return undefined;
    }

    let rate = 0;
    if (typeof rawVal === 'string') {
      const trimmed = rawVal.trim();
      if (trimmed.endsWith('%')) {
        rate = parseFloat(trimmed.slice(0, -1)) / 100;
      } else {
        rate = parseFloat(trimmed);
      }
    } else if (typeof rawVal === 'number') {
      rate = rawVal;
    }

    if (isNaN(rate)) {
      return undefined;
    }

    // If user passed a percentage integer like 20 or 50
    if (rate > 1 && rate <= 100) {
      rate = rate / 100;
    }

    return Math.min(1, Math.max(0, rate));
  }

  /**
   * Parse mock error status code or special mode. Supports:
   * - 500, 503, 404, etc.
   * - 'drop' / 'hangup' for socket destruction
   */
  public parseErrorStatus(rawVal: any): number | 'drop' | undefined {
    if (rawVal === undefined || rawVal === null || rawVal === '') {
      return undefined;
    }

    const strVal = String(rawVal).trim().toLowerCase();
    if (strVal === 'drop' || strVal === 'hangup' || strVal === 'socket_hangup' || strVal === 'reset') {
      return 'drop';
    }

    const code = parseInt(strVal, 10);
    if (!isNaN(code) && code >= 400 && code <= 599) {
      return code;
    }

    // If raw value was provided but invalid status number (e.g. true or general error), default to 500
    return 500;
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
