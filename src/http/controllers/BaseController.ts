import { FastifyReply } from 'fastify';

export abstract class BaseController {
  protected ok<T>(reply: FastifyReply, data: T, statusCode = 200): void {
    reply.status(statusCode).send(data);
  }

  protected noContent(reply: FastifyReply): void {
    reply.status(204).send();
  }

  protected error(reply: FastifyReply, message: string, statusCode = 400, data?: any): void {
    reply.status(statusCode).send({
      statusCode,
      message,
      data,
    });
  }
}
