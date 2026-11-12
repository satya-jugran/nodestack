import { FastifyReply } from 'fastify';
import * as crypto from 'crypto';
import { RuleEngine } from '../rules/RuleEngine';
import { SchemaService } from '../schema/SchemaService';
import { CollectionModel } from '../schema/models/Collection';
import { RecordSanitizer } from '../records/RecordSanitizer';
import { AppError, ForbiddenError, UnauthorizedError } from '../core/errors/AppError';
import { hashSecret, verifySecret } from '../core/crypto/secret';

export type RealtimeAuthRevalidator = (auth: any) => boolean | Promise<boolean>;

export interface RealtimeIdentityFilter {
  collection?: string;
  id?: string;
  email?: string;
  isApiKey?: boolean;
  onlySuperAdmin?: boolean;
}

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
  private clientValidators = new Map<string, RealtimeAuthRevalidator>();
  private revokedClientIds = new Set<string>();
  private readonly maxRevokedClientIds = 5000;
  private defaultAuthValidator?: RealtimeAuthRevalidator;
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

  public setAuthValidator(validator?: RealtimeAuthRevalidator): void {
    this.defaultAuthValidator = validator;
  }

  public registerClient(
    reply: FastifyReply,
    auth?: any,
    revalidateAuth?: RealtimeAuthRevalidator
  ): string {
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
    if (revalidateAuth) {
      this.clientValidators.set(id, revalidateAuth);
    }

    // Send initial NodeStack connect event (NS_CONNECT, with NB_CONNECT for compatibility)
    const connectPayload = JSON.stringify({ clientId: id, clientSecret });
    reply.raw.write(`event: NS_CONNECT\ndata: ${connectPayload}\n\n`);
    reply.raw.write(`event: NB_CONNECT\ndata: ${connectPayload}\n\n`);

    reply.raw.on('close', () => {
      this.cleanupDisconnectedClient(id);
    });

    return id;
  }

  public setSubscriptions(
    clientId: string,
    subscriptions: string[],
    options: SetSubscriptionsOptions = {}
  ): boolean | Promise<boolean> {
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

    if (this.revokedClientIds.has(clientId)) {
      throw new UnauthorizedError('Authentication session for this realtime client has been revoked');
    }

    const client = this.clients.get(clientId);
    if (!client) return false;

    const finishSetSubscriptions = (): boolean => {
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
    };

    if (client.auth) {
      const validOrPromise = this.revalidateClient(client);
      if (validOrPromise && typeof (validOrPromise as any).then === 'function') {
        return (validOrPromise as Promise<boolean>).then((isValid) => {
          if (!isValid) {
            throw new UnauthorizedError('Authentication session for this realtime client has been revoked');
          }
          return finishSetSubscriptions();
        });
      }
      if (!validOrPromise) {
        throw new UnauthorizedError('Authentication session for this realtime client has been revoked');
      }
    }

    return finishSetSubscriptions();
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
      client.subscriptions.clear();
      this.cleanupDisconnectedClient(clientId);
      try {
        client.reply.raw.end();
      } catch {
        // ignore
      }
    }
  }

  /**
   * Immediately disconnects and revokes active SSE clients matching the given identity filter.
   */
  public revokeClientsByIdentity(filter: RealtimeIdentityFilter): number {
    let revoked = 0;
    for (const client of Array.from(this.clients.values())) {
      if (this.clientMatchesFilter(client, filter)) {
        this.revokeAndCloseClient(client);
        revoked++;
      }
    }
    return revoked;
  }

  /**
   * Revalidates active SSE clients matching the given identity filter and closes any
   * whose session or credentials are no longer valid.
   */
  public revalidateClientsByIdentity(filter: RealtimeIdentityFilter): void | Promise<void> {
    const pending: Array<Promise<boolean>> = [];
    for (const client of Array.from(this.clients.values())) {
      if (!this.clientMatchesFilter(client, filter)) continue;
      const result = this.revalidateClient(client);
      if (result && typeof (result as any).then === 'function') {
        pending.push(result as Promise<boolean>);
      }
    }
    if (pending.length > 0) {
      return Promise.all(pending).then(() => {});
    }
  }

  private cleanupDisconnectedClient(clientId: string): void {
    this.clients.delete(clientId);
    this.clientValidators.delete(clientId);
  }

  private markClientRevoked(clientId: string): void {
    if (this.revokedClientIds.has(clientId)) return;
    if (this.revokedClientIds.size >= this.maxRevokedClientIds) {
      const oldest = this.revokedClientIds.values().next().value;
      if (oldest) this.revokedClientIds.delete(oldest);
    }
    this.revokedClientIds.add(clientId);
  }

  private revokeAndCloseClient(client: RealtimeClient): void {
    client.subscriptions.clear();
    client.auth = null;
    this.markClientRevoked(client.id);
    this.cleanupDisconnectedClient(client.id);
    try {
      client.reply.raw.end();
    } catch {
      // ignore
    }
  }

  private revalidateClient(client: RealtimeClient): boolean | Promise<boolean> {
    if (!client.auth) {
      return true;
    }

    if (typeof client.auth.exp === 'number' && Math.floor(Date.now() / 1000) >= client.auth.exp) {
      this.revokeAndCloseClient(client);
      return false;
    }

    const validator = this.clientValidators.get(client.id) || this.defaultAuthValidator;
    if (!validator) {
      return true;
    }

    try {
      const res = validator(client.auth);
      if (res && typeof (res as any).then === 'function') {
        return (res as Promise<boolean>).then(
          (valid) => {
            if (!valid) {
              this.revokeAndCloseClient(client);
              return false;
            }
            return true;
          },
          () => {
            this.revokeAndCloseClient(client);
            return false;
          }
        );
      }

      if (!res) {
        this.revokeAndCloseClient(client);
        return false;
      }
      return true;
    } catch {
      this.revokeAndCloseClient(client);
      return false;
    }
  }

  private clientMatchesFilter(client: RealtimeClient, filter: RealtimeIdentityFilter): boolean {
    if (!client.auth) return false;
    if (filter.onlySuperAdmin && (!client.auth.isSuperAdmin || client.auth.isTenantScoped)) {
      return false;
    }

    const cleanEmail = filter.email?.trim().toLowerCase();
    if (filter.isApiKey || filter.collection === '_api_keys') {
      if (!client.auth.isApiKey) return false;
      if (filter.id) {
        return (client.auth.apiKeyId || client.auth.id) === filter.id;
      }
      return true;
    }

    if (client.auth.isApiKey) return false;

    if (filter.collection === '_admins') {
      if (!client.auth.isAdmin && client.auth.collection !== '_admins') return false;
    } else if (filter.collection && client.auth.collection !== filter.collection) {
      return false;
    }

    if (filter.id || cleanEmail) {
      const idMatches = Boolean(filter.id && client.auth.id === filter.id);
      const emailMatches = Boolean(
        cleanEmail && typeof client.auth.email === 'string' && client.auth.email.toLowerCase() === cleanEmail
      );
      return idMatches || emailMatches;
    }

    return true;
  }

  private writeFrameToAuthorizedClient(client: RealtimeClient, frame: string): void {
    const attemptWrite = () => {
      if (!this.clients.has(client.id)) return;
      try {
        client.reply.raw.write(frame);
      } catch {
        this.cleanupDisconnectedClient(client.id);
      }
    };

    if (!client.auth) {
      attemptWrite();
      return;
    }

    const validOrPromise = this.revalidateClient(client);
    if (validOrPromise && typeof (validOrPromise as any).then === 'function') {
      (validOrPromise as Promise<boolean>)
        .then((valid) => {
          if (valid) attemptWrite();
        })
        .catch(() => {});
      return;
    }

    if (validOrPromise) {
      attemptWrite();
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

    for (const [, client] of Array.from(this.clients.entries())) {
      // Check if client is subscribed to '*' or collection or collection/id
      const isSubscribed =
        client.subscriptions.has('*') ||
        client.subscriptions.has(collectionName) ||
        client.subscriptions.has(`${collectionName}/*`) ||
        client.subscriptions.has(`${collectionName}/${record.id}`);

      if (!isSubscribed) continue;

      if (client.auth) {
        const validOrPromise = this.revalidateClient(client);
        const isValid =
          validOrPromise && typeof (validOrPromise as any).then === 'function'
            ? await validOrPromise
            : Boolean(validOrPromise);
        if (!isValid || !this.clients.has(client.id)) {
          continue;
        }
      }

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
        this.cleanupDisconnectedClient(client.id);
      }
    }
  }

  public broadcastSystemEvent(event: string, data: Record<string, any> = {}): void {
    const payload = JSON.stringify(data);
    const frame = `event: ${event}\ndata: ${payload}\n\n`;
    for (const [, client] of Array.from(this.clients.entries())) {
      this.writeFrameToAuthorizedClient(client, frame);
    }
  }

  private pingAll(): void {
    for (const [, client] of Array.from(this.clients.entries())) {
      this.writeFrameToAuthorizedClient(client, ':keepalive\n\n');
    }
  }

  public dispose(): void {
    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval);
    }
    for (const [, client] of Array.from(this.clients.entries())) {
      client.subscriptions.clear();
      try {
        client.reply.raw.end();
      } catch {
        // ignore
      }
    }
    this.clients.clear();
    this.clientValidators.clear();
    this.revokedClientIds.clear();
  }
}
