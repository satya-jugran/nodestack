import { FastifyRequest, FastifyReply } from 'fastify';
import { BaseController } from './BaseController';
import { AppError } from '../../core/errors/AppError';
import { FlowService } from '../../flows/FlowService';
import { CreateFlowDto, UpdateFlowDto } from '../../flows/types';

export class FlowController extends BaseController {
  constructor(private flowService?: FlowService) {
    super();
  }

  private getFlowsService(req: any): FlowService {
    return req?.appScope?.flows || this.flowService;
  }

  // ==========================================
  // Flow CRUD Endpoints
  // ==========================================

  public async getFlows(
    req: FastifyRequest<{ Querystring: { search?: string; enabled?: string } }>,
    reply: FastifyReply
  ): Promise<void> {
    const service = this.getFlowsService(req);
    const enabled =
      req.query.enabled !== undefined
        ? req.query.enabled === 'true' || req.query.enabled === '1'
        : undefined;

    const flows = service.getAllFlows({
      search: req.query.search,
      enabled,
    });
    this.ok(reply, flows);
  }

  public async getFlow(
    req: FastifyRequest<{ Params: { id: string } }>,
    reply: FastifyReply
  ): Promise<void> {
    const service = this.getFlowsService(req);
    const flow = service.getFlowById(req.params.id) || service.getFlowByName(req.params.id);
    if (!flow) {
      this.error(reply, 'Flow not found', 404);
      return;
    }
    this.ok(reply, flow);
  }

  public async createFlow(
    req: FastifyRequest<{ Body: CreateFlowDto }>,
    reply: FastifyReply
  ): Promise<void> {
    const service = this.getFlowsService(req);
    try {
      const created = service.createFlow(req.body, (req as any).auth);
      this.ok(reply, created, 201);
    } catch (err: any) {
      if (err instanceof AppError) {
        this.error(reply, err.message, err.statusCode);
        return;
      }
      this.error(reply, err.message || 'Failed to create flow', 400);
    }
  }

  public async updateFlow(
    req: FastifyRequest<{ Params: { id: string }; Body: UpdateFlowDto }>,
    reply: FastifyReply
  ): Promise<void> {
    const service = this.getFlowsService(req);
    try {
      const updated = service.updateFlow(req.params.id, req.body, (req as any).auth);
      this.ok(reply, updated);
    } catch (err: any) {
      if (err instanceof AppError) {
        this.error(reply, err.message, err.statusCode);
        return;
      }
      this.error(reply, err.message || 'Failed to update flow', 400);
    }
  }

  public async deleteFlow(
    req: FastifyRequest<{ Params: { id: string } }>,
    reply: FastifyReply
  ): Promise<void> {
    const service = this.getFlowsService(req);
    try {
      service.deleteFlow(req.params.id, (req as any).auth);
      this.ok(reply, { success: true, message: 'Flow deleted successfully' });
    } catch (err: any) {
      if (err instanceof AppError) {
        this.error(reply, err.message, err.statusCode);
        return;
      }
      this.error(reply, err.message || 'Failed to delete flow', 400);
    }
  }

  // ==========================================
  // Flow Execution & History Endpoints
  // ==========================================

  public async executeFlow(
    req: FastifyRequest<{ Params: { id: string }; Querystring: { wait?: string }; Body: any }>,
    reply: FastifyReply
  ): Promise<void> {
    const service = this.getFlowsService(req);
    const wait = req.query.wait === 'true' || req.query.wait === '1';

    try {
      if (wait) {
        const execution = await service.executeFlow(req.params.id, req.body || {}, (req as any).auth, { wait: true });
        this.ok(reply, execution);
      } else {
        // Fire-and-forget execution
        const flow = service.getFlowById(req.params.id) || service.getFlowByName(req.params.id);
        if (!flow) {
          this.error(reply, 'Flow not found', 404);
          return;
        }

        // Trigger in background
        service.executeFlow(flow.id, req.body || {}, (req as any).auth).catch((err) => {
          console.error(`[FlowController] Background execution failed for flow '${flow.name}':`, err);
        });

        this.ok(reply, { status: 'running', message: `Flow '${flow.name}' triggered in background` }, 202);
      }
    } catch (err: any) {
      if (err instanceof AppError) {
        this.error(reply, err.message, err.statusCode);
        return;
      }
      this.error(reply, err.message || 'Failed to execute flow', 500);
    }
  }

  public async getExecutions(
    req: FastifyRequest<{
      Params?: { id?: string };
      Querystring: { flowId?: string; status?: string; page?: string; perPage?: string };
    }>,
    reply: FastifyReply
  ): Promise<void> {
    const service = this.getFlowsService(req);
    const flowId = req.params?.id || req.query.flowId;
    const page = req.query.page ? parseInt(req.query.page, 10) : 1;
    const perPage = req.query.perPage ? parseInt(req.query.perPage, 10) : 20;

    const result = service.getExecutions({
      flowId,
      status: req.query.status,
      page,
      perPage,
    });
    this.ok(reply, result);
  }

  public async getExecution(
    req: FastifyRequest<{ Params: { executionId: string } }>,
    reply: FastifyReply
  ): Promise<void> {
    const service = this.getFlowsService(req);
    const execution = service.getExecutionById(req.params.executionId);
    if (!execution) {
      this.error(reply, 'Flow execution not found', 404);
      return;
    }
    this.ok(reply, execution);
  }

  public async clearExecutions(
    req: FastifyRequest<{ Params?: { id?: string } }>,
    reply: FastifyReply
  ): Promise<void> {
    const service = this.getFlowsService(req);
    const flowId = req.params?.id;
    service.clearExecutions(flowId);
    this.ok(reply, { success: true, message: 'Executions cleared' });
  }
}
