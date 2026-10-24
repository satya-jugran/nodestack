import { FastifyRequest, FastifyReply } from 'fastify';
import { BaseController } from './BaseController';
import { SnapshotService } from '../../snapshots/SnapshotService';
import { NotFoundError } from '../../core/errors/AppError';

export class SnapshotController extends BaseController {
  constructor(private snapshotService: SnapshotService) {
    super();
  }

  private getService(req: any): SnapshotService {
    return req?.appScope?.snapshots || req?.appScope?.demo || this.snapshotService;
  }

  /**
   * GET /api/snapshots
   * Returns all snapshots, active baseline, and live drift information.
   */
  public async listSnapshots(req: FastifyRequest, reply: FastifyReply): Promise<void> {
    const service = this.getService(req);
    const status = service.getStatus();
    this.ok(reply, status);
  }

  /**
   * POST /api/snapshots
   * Creates a new application state snapshot.
   * If limit of 10 is reached, evictOldest: true must be provided to prune the oldest.
   */
  public async createSnapshot(
    req: FastifyRequest<{
      Body?: { name?: string; description?: string; evictOldest?: boolean };
    }>,
    reply: FastifyReply
  ): Promise<void> {
    const service = this.getService(req);
    const metadata = await service.createSnapshot({
      name: req.body?.name,
      description: req.body?.description,
      evictOldest: req.body?.evictOldest,
    });
    this.ok(reply, metadata, 201);
  }

  /**
   * GET /api/snapshots/:id
   * Retrieves metadata of a single snapshot.
   */
  public async getSnapshot(
    req: FastifyRequest<{ Params: { id: string } }>,
    reply: FastifyReply
  ): Promise<void> {
    const service = this.getService(req);
    const snapshot = service.getSnapshot(req.params.id);
    if (!snapshot) {
      throw new NotFoundError(`Snapshot with ID '${req.params.id}' was not found.`);
    }
    this.ok(reply, snapshot);
  }

  /**
   * POST /api/snapshots/:id/restore
   * Restores application database and files to a specific snapshot.
   */
  public async restoreSnapshot(
    req: FastifyRequest<{ Params: { id: string } }>,
    reply: FastifyReply
  ): Promise<void> {
    const service = this.getService(req);
    const result = await service.restoreSnapshot(req.params.id);
    this.ok(reply, result);
  }

  /**
   * DELETE /api/snapshots/:id
   * Removes a specific snapshot.
   */
  public async deleteSnapshot(
    req: FastifyRequest<{ Params: { id: string } }>,
    reply: FastifyReply
  ): Promise<void> {
    const service = this.getService(req);
    await service.deleteSnapshot(req.params.id);
    this.noContent(reply);
  }

  /**
   * DELETE /api/snapshots
   * Clears all saved snapshots.
   */
  public async clearAllSnapshots(req: FastifyRequest, reply: FastifyReply): Promise<void> {
    const service = this.getService(req);
    await service.clearAllSnapshots();
    this.noContent(reply);
  }
}
