import { FastifyReply } from 'fastify';
import * as crypto from 'crypto';
import { RuleEngine } from '../rules/RuleEngine';
import { SchemaService } from '../schema/SchemaService';
import { CollectionModel } from '../schema/models/Collection';
import { RecordSanitizer } from '../records/RecordSanitizer';
import { AppError, ForbiddenError, UnauthorizedError } from '../core/errors/AppError';
import { hashSecret, verifySecret } from '../core/crypto/secret';

export interface RealtimeClient {
  id: string;
  reply: FastifyReply;
  subscriptions: Set<string>;
  auth?: any;
  secretHash?: string;
}

export interface SetSubscriptionsOptions {
  callerAuth?: any;
  clientSecret?: string;
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
    const clientSecret = crypto.randomBytes(32).toString('hex');
    const client: RealtimeClient = {
      id,
      reply,
      subscriptions: new Set<string>(),
      auth: auth ? { ...auth } : null,
      secretHash: hashSecret(clientSecret),
    };

    this.clients.set(id, client);

    // Send initial NodeStack connect event (NS_CONNECT, with NB_CONNECT for compatibility)
    const connectPayload = JSON.stringify({ clientId: id, clientSecret });
    reply.raw.write(`event: NS_CONNECT\ndata: ${connectPayload}\n\n`);
    reply.raw.write(`event: NB_CONNECT\ndata: ${connectPayload}\n\n`);

    reply.raw.on('close', () => {
      this.clients.delete(id);
    });

    return id;
  }

  public setSubscriptions(
    clientId: string,
    subscriptions: string[],
    options: SetSubscriptionsOptions = {}
  ): boolean {
    if (!clientId || typeof clientId !== 'string' || !Array.isArray(subscriptions)) {
      throw new AppError('clientId and subscriptions array are required', 400);
    }

    const callerAuth = options.callerAuth ?? null;
    const providedSecret =
      typeof options.clientSecret === 'string' && options.clientSecret.trim()
        ? options.clientSecret.trim()
        : undefined;

    if (!callerAuth && !providedSecret) {
      throw new UnauthorizedError('Authentication or realtime client secret is required');
    }

    const client = this.clients.get(clientId);
    if (!client) return false;

    if (client.auth) {
      if (!callerAuth) {
        throw new UnauthorizedError('Authentication is required to manage subscriptions for this realtime client');
      }
      if (!this.isSameCallerAuth(client.auth, callerAuth)) {
        throw new ForbiddenError('Caller is not authorized to modify subscriptions for this realtime client');
      }
      if (options.clientSecret !== undefined && !verifySecret(client.secretHash, options.clientSecret.trim())) {
        throw new ForbiddenError('Invalid realtime client secret');
      }
    } else {
      if (!providedSecret) {
        throw new ForbiddenError('Realtime client secret is required to manage subscriptions for this client');
      }
      if (!verifySecret(client.secretHash, providedSecret)) {
        throw new ForbiddenError('Invalid realtime client secret');
      }
    }

    client.subscriptions.clear();
    for (const sub of subscriptions) {
      if (typeof sub !== 'string') {
        throw new AppError('All subscription entries must be strings', 400);
      }
      client.subscriptions.add(sub.trim());
    }
    return true;
  }

  private isSameCallerAuth(clientAuth: any, callerAuth: any): boolean {
    if (!clientAuth || !callerAuth) {
      return false;
    }

    const clientIsApiKey = Boolean(clientAuth.isApiKey);
    const callerIsApiKey = Boolean(callerAuth.isApiKey);
    if (clientIsApiKey !== callerIsApiKey) {
      return false;
    }

    if (clientIsApiKey) {
      const clientKeyId = clientAuth.apiKeyId || clientAuth.id;
      const callerKeyId = callerAuth.apiKeyId || callerAuth.id;
      if (!clientKeyId || !callerKeyId || clientKeyId !== callerKeyId) {
        return false;
      }
      if ((clientAuth.appId ?? null) !== (callerAuth.appId ?? null)) {
        return false;
      }
      return true;
    }

    if (!clientAuth.id || !callerAuth.id || clientAuth.id !== callerAuth.id) {
      return false;
    }
    if ((clientAuth.collection ?? null) !== (callerAuth.collection ?? null)) {
      return false;
    }
    if (Boolean(clientAuth.isAdmin) !== Boolean(callerAuth.isAdmin)) {
      return false;
    }
    if (Boolean(clientAuth.isSuperAdmin) !== Boolean(callerAuth.isSuperAdmin)) {
      return false;
    }
    if (Boolean(clientAuth.isTenantScoped) !== Boolean(callerAuth.isTenantScoped)) {
      return false;
    }
    if ((clientAuth.appId ?? null) !== (callerAuth.appId ?? null)) {
      return false;
    }
    if (clientAuth.tokenKey || callerAuth.tokenKey) {
      if (!clientAuth.tokenKey || !callerAuth.tokenKey || clientAuth.tokenKey !== callerAuth.tokenKey) {
        return false;
      }
    }

    return true;
  }

  public getConnectedClientsCount(): number {
    return this.clients.size;
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

  public sanitizeRecord(
    record: Record<string, any>,
    collection: CollectionModel,
    auth?: any
  ): Record<string, any> {
    return RecordSanitizer.sanitize(record, collection, auth, false);
  }

  public async broadcast(action: RealtimeAction, collectionName: string, record: Record<string, any>): Promise<void> {
    const collection = await this.schemaService.getCollection(collectionName);
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

      // Re-sanitize the record before dispatching SSE payloads to each client,
      // checking client.auth.id === record.id or client.auth.isAdmin before including protected fields.
      const clientRecord = this.sanitizeRecord(record, collection, client.auth);

      const payload = JSON.stringify({
        action,
        record: clientRecord,
      });

      try {
        client.reply.raw.write(`event: ${collectionName}\ndata: ${payload}\n\n`);
      } catch {
        // handle disconnected client
        this.clients.delete(client.id);
      }
    }
  }

  public broadcastSystemEvent(event: string, data: Record<string, any> = {}): void {
    const payload = JSON.stringify(data);
    for (const [, client] of this.clients) {
      try {
        client.reply.raw.write(`event: ${event}\ndata: ${payload}\n\n`);
      } catch {
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
