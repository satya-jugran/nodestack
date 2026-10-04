import { FastifyRequest, FastifyReply } from 'fastify';
import { BaseController } from './BaseController';
import { DemoService } from '../../demo/DemoService';

export class DemoController extends BaseController {
  constructor(private demoService: DemoService) {
    super();
  }

  /**
   * GET /api/demo/status
   * Returns snapshot availability, metadata, and live drift information.
   */
  public async getStatus(_req: FastifyRequest, reply: FastifyReply): Promise<void> {
    const status = this.demoService.getStatus();
    this.ok(reply, status);
  }

  /**
   * POST /api/demo/snapshot
   * Freezes current database & file storage state as the demo baseline.
   */
  public async createSnapshot(
    req: FastifyRequest<{ Body?: { name?: string; description?: string } }>,
    reply: FastifyReply
  ): Promise<void> {
    const metadata = await this.demoService.snapshot({
      name: req.body?.name,
      description: req.body?.description,
    });
    this.ok(reply, metadata, 201);
  }

  /**
   * POST /api/demo/reset
   * Restores the exact pristine demo state in one click.
   */
  public async reset(_req: FastifyRequest, reply: FastifyReply): Promise<void> {
    const result = await this.demoService.reset();
    this.ok(reply, result);
  }

  /**
   * DELETE /api/demo/snapshot
   * Removes the frozen demo snapshot.
   */
  public async clearSnapshot(_req: FastifyRequest, reply: FastifyReply): Promise<void> {
    await this.demoService.clearSnapshot();
    this.noContent(reply);
  }
}
