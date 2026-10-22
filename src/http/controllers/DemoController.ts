import { FastifyRequest, FastifyReply } from 'fastify';
import { BaseController } from './BaseController';
import { DemoService } from '../../demo/DemoService';

export class DemoController extends BaseController {
  constructor(private demoService: DemoService) {
    super();
  }

  private getDemo(req: any): DemoService {
    return req?.appScope?.demo || this.demoService;
  }

  /**
   * GET /api/demo/status
   * Returns snapshot availability, metadata, and live drift information.
   */
  public async getStatus(req: FastifyRequest, reply: FastifyReply): Promise<void> {
    const demo = this.getDemo(req);
    const status = demo.getStatus();
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
    const demo = this.getDemo(req);
    const metadata = await demo.snapshot({
      name: req.body?.name,
      description: req.body?.description,
    });
    this.ok(reply, metadata, 201);
  }

  /**
   * POST /api/demo/reset
   * Restores the exact pristine demo state in one click.
   */
  public async reset(req: FastifyRequest, reply: FastifyReply): Promise<void> {
    const demo = this.getDemo(req);
    const result = await demo.reset();
    this.ok(reply, result);
  }

  /**
   * DELETE /api/demo/snapshot
   * Removes the frozen demo snapshot.
   */
  public async clearSnapshot(req: FastifyRequest, reply: FastifyReply): Promise<void> {
    const demo = this.getDemo(req);
    await demo.clearSnapshot();
    this.noContent(reply);
  }
}
