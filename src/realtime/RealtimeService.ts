import { FastifyReply } from 'fastify';
import * as crypto from 'crypto';
import { RuleEngine } from '../rules/RuleEngine';
import { SchemaService } from '../schema/SchemaService';

export interface RealtimeClient {
  id: string;
  reply: FastifyReply;
  subscriptions: Set<string>;
  auth?: any;
}

export type RealtimeAction = 'create' | 'update' | 'delete';

export class RealtimeService {
  private clients = new Map<string, RealtimeClient>();
  private heartbeatInterval?: NodeJS.Timeout;

  constructor(
    private ruleEngine: RuleEngine,
    private schemaService: SchemaService
  ) {
    // Send keepalive pings every 25 seconds
    this.heartbeatInterval = setInterval(() => {
      this.pingAll();
    }, 25000);
    if (this.heartbeatInterval && typeof this.heartbeatInterval.unref === 'function') {
      this.heartbeatInterval.unref();
    }
  }

  public registerClient(reply: FastifyReply, auth?: any): string {
    const id = `cl_${crypto.randomBytes(8).toString('hex')}`;
    const client: RealtimeClient = {
      id,
      reply,
      subscriptions: new Set<string>(),
      auth,
    };

    this.clients.set(id, client);

    // Send initial NodeStack connect event (NS_CONNECT, with NB_CONNECT for compatibility)
    reply.raw.write(`event: NS_CONNECT\ndata: {"clientId":"${id}"}\n\n`);
    reply.raw.write(`event: NB_CONNECT\ndata: {"clientId":"${id}"}\n\n`);

    reply.raw.on('close', () => {
      this.clients.delete(id);
    });

    return id;
  }

  public setSubscriptions(clientId: string, subscriptions: string[]): boolean {
    const client = this.clients.get(clientId);
    if (!client) return false;

    client.subscriptions.clear();
    for (const sub of subscriptions) {
      client.subscriptions.add(sub.trim());
    }
    return true;
  }

  public removeClient(clientId: string): void {
    const client = this.clients.get(clientId);
    if (client) {
      try {
        client.reply.raw.end();
      } catch {
        // ignore
      }
      this.clients.delete(clientId);
    }
  }

  public broadcast(action: RealtimeAction, collectionName: string, record: Record<string, any>): void {
    const collection = this.schemaService.getCollection(collectionName);
    if (!collection) return;

    for (const [, client] of this.clients) {
      // Check if client is subscribed to '*' or collection or collection/id
      const isSubscribed =
        client.subscriptions.has('*') ||
        client.subscriptions.has(collectionName) ||
        client.subscriptions.has(`${collectionName}/*`) ||
        client.subscriptions.has(`${collectionName}/${record.id}`);

      if (!isSubscribed) continue;

      // Check viewRule permission for this client
      const canView = this.ruleEngine.evaluate(collection.viewRule, {
        auth: client.auth,
        record,
      });

      if (!canView) continue;

      const payload = JSON.stringify({
        action,
        record,
      });

      try {
        client.reply.raw.write(`event: ${collectionName}\ndata: ${payload}\n\n`);
      } catch {
        // handle disconnected client
        this.clients.delete(client.id);
      }
    }
  }

  private pingAll(): void {
    for (const [id, client] of this.clients) {
      try {
        client.reply.raw.write(':keepalive\n\n');
      } catch {
        this.clients.delete(id);
      }
    }
  }

  public dispose(): void {
    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval);
    }
    for (const [, client] of this.clients) {
      try {
        client.reply.raw.end();
      } catch {
        // ignore
      }
    }
    this.clients.clear();
  }
}
