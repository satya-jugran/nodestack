import { FastifyRequest, FastifyReply } from 'fastify';
import { BaseController } from './BaseController';
import { AppError } from '../../core/errors/AppError';
import { FlowService } from '../../flows/FlowService';
import { CreateFlowDto, UpdateFlowDto, FlowAsyncDispatchResponse } from '../../flows/types';

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
    const flow = service.getFlowById(req.params.id) || service.getFlowByName(req.params.id);
    if (!flow) {
      this.error(reply, 'Flow not found', 404);
      return;
    }

    if (!flow.enabled) {
      this.error(reply, `Flow '${flow.name}' is currently disabled`, 403);
      return;
    }

    // If triggerType is not 'http', require admin credentials
    if (flow.triggerType !== 'http') {
      const auth = (req as any).auth;
      if (!auth || !auth.isAdmin) {
        this.error(
          reply,
          `Flow '${flow.name}' has triggerType '${flow.triggerType}' and requires admin credentials to execute directly`,
          403
        );
        return;
      }
    }

    const wait = req.query.wait === 'true' || req.query.wait === '1';

    try {
      if (wait) {
        const execution = await service.executeFlow(flow.id, req.body || {}, (req as any).auth, {
          wait: true,
          executionId: (req.body as any)?.executionId,
        });
        this.ok(reply, execution);
      } else {
        const executionId = (req.body as any)?.executionId || FlowService.generateExecutionId();
        const appId = (req.params as any)?.appId;
        const pollUrl = appId
          ? `/api/apps/${appId}/flows/executions/${executionId}`
          : `/api/flows/executions/${executionId}`;

        // Fire-and-forget execution with pre-generated executionId
        service.executeFlow(flow.id, req.body || {}, (req as any).auth, { executionId }).catch((err) => {
          console.error(`[FlowController] Background execution failed for flow '${flow.name}':`, err);
        });

        const response: FlowAsyncDispatchResponse = {
          executionId,
          flowId: flow.id,
          flowName: flow.name,
          status: 'running',
          pollUrl,
        };

        this.ok(reply, response, 202);
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

    const flow = service.getFlowById(execution.flowId);
    if (flow && flow.triggerType !== 'http') {
      const auth = (req as any).auth;
      if (!auth || !auth.isAdmin) {
        this.error(reply, `Flow execution for '${execution.flowName}' requires admin credentials`, 403);
        return;
      }
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

  public async resumeExecution(
    req: FastifyRequest<{ Params: { executionId: string } }>,
    reply: FastifyReply
  ): Promise<void> {
    const service = this.getFlowsService(req);
    try {
      const execution = await service.resumeExecution(req.params.executionId);
      this.ok(reply, execution);
    } catch (err: any) {
      if (err instanceof AppError) {
        this.error(reply, err.message, err.statusCode);
        return;
      }
      this.error(reply, err.message || 'Failed to resume execution', 400);
    }
  }

  public async abortExecution(
    req: FastifyRequest<{ Params: { executionId: string }; Body?: { reason?: string } }>,
    reply: FastifyReply
  ): Promise<void> {
    const service = this.getFlowsService(req);
    try {
      const reason = req.body?.reason || 'Execution aborted by admin';
      const execution = service.abortExecution(req.params.executionId, reason);
      this.ok(reply, execution);
    } catch (err: any) {
      if (err instanceof AppError) {
        this.error(reply, err.message, err.statusCode);
        return;
      }
      this.error(reply, err.message || 'Failed to abort execution', 400);
    }
  }

  public async recoverExecutions(
    req: FastifyRequest<{ Body?: { strategy?: 'abort' | 'resume' } }>,
    reply: FastifyReply
  ): Promise<void> {
    const service = this.getFlowsService(req);
    try {
      const strategy = req.body?.strategy;
      const recovered = await service.recoverOrphanedExecutions(strategy);
      this.ok(reply, { recovered, count: recovered.length });
    } catch (err: any) {
      if (err instanceof AppError) {
        this.error(reply, err.message, err.statusCode);
        return;
      }
      this.error(reply, err.message || 'Failed to recover executions', 500);
    }
  }
}
