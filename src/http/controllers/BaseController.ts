import { FastifyReply } from 'fastify';

/**
 * Builds an RFC 6266 / RFC 5987 compliant Content-Disposition header value.
 * Strips ASCII control characters and line separators to prevent HTTP header
 * injection, provides an ASCII-safe quoted fallback `filename="..."`, and
 * encodes the sanitized UTF-8 filename using `filename*=UTF-8''...`.
 */
export function buildContentDispositionHeader(
  filename: string,
  disposition: 'attachment' | 'inline' = 'attachment'
): string {
  const cleaned = (typeof filename === 'string' ? filename : '')
    .replace(/[\x00-\x1f\x7f\u2028\u2029]/g, '')
    .replace(/[/\\]/g, '_')
    .trim();

  const effectiveName = !cleaned || cleaned === '.' || cleaned === '..' ? 'download' : cleaned;
  const asciiFallback = effectiveName.replace(/[^\x20-\x7e]|["\\;]/g, '_') || 'download';

  let encodedInput = effectiveName;
  try {
    encodeURIComponent(encodedInput);
  } catch {
    encodedInput = asciiFallback;
  }

  const rfc5987Encoded = encodeURIComponent(encodedInput).replace(
    /['()*!]/g,
    (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`
  );

  return `${disposition}; filename="${asciiFallback}"; filename*=UTF-8''${rfc5987Encoded}`;
}

export abstract class BaseController {
  protected ok<T>(reply: FastifyReply, data: T, statusCode = 200): void {
    reply.status(statusCode).send(data);
  }

  protected noContent(reply: FastifyReply): void {
    reply.status(204).send();
  }

  protected setContentDisposition(
    reply: FastifyReply,
    filename: string,
    disposition: 'attachment' | 'inline' = 'attachment'
  ): void {
    reply.header('Content-Disposition', buildContentDispositionHeader(filename, disposition));
  }

  protected error(reply: FastifyReply, message: string, statusCode = 400, data?: any): void {
    reply.status(statusCode).send({
      statusCode,
      message,
      data,
    });
  }
}
