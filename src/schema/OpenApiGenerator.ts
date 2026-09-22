import { CollectionModel } from './models/Collection';
import { SchemaField } from './models/Field';
import { SchemaService } from './SchemaService';

export interface OpenApiGeneratorOptions {
  title?: string;
  version?: string;
  description?: string;
  serverUrl?: string;
}

export class OpenApiGenerator {
  constructor(
    private schemaService: SchemaService,
    private defaultOptions: OpenApiGeneratorOptions = {}
  ) {}

  /**
   * Generates the OpenAPI 3.0 specification object from the current collections schema.
   */
  public generate(options?: OpenApiGeneratorOptions): Record<string, any> {
    const collections = this.schemaService.getAllCollections();
    return OpenApiGenerator.generateFromCollections(collections, {
      ...this.defaultOptions,
      ...options,
    });
  }

  /**
   * Generates formatted OpenAPI JSON string.
   */
  public generateJson(pretty = true, options?: OpenApiGeneratorOptions): string {
    const spec = this.generate(options);
    return JSON.stringify(spec, null, pretty ? 2 : undefined);
  }

  /**
   * Pure static generator that transforms a list of CollectionModel into
   * a compliant OpenAPI 3.0.3 specification object.
   */
  public static generateFromCollections(
    collections: CollectionModel[],
    options: OpenApiGeneratorOptions = {}
  ): Record<string, any> {
    const title = options.title || 'NodeStack API';
    const version = options.version || '0.1.0';
    const description =
      options.description ||
      'Interactive OpenAPI 3.0 specification for NodeStack backend. Dynamically generated from collection schemas.';
    const serverUrl = options.serverUrl || '/';

    const tags: Array<{ name: string; description: string }> = [];
    const paths: Record<string, any> = {};
    const schemas: Record<string, any> = {};

    // 1. Common Shared Schemas
    schemas.ErrorResponse = {
      type: 'object',
      properties: {
        statusCode: { type: 'integer', example: 400 },
        message: { type: 'string', example: 'Validation error or invalid request' },
        data: { type: 'object', additionalProperties: true },
      },
      required: ['statusCode', 'message'],
    };

    schemas.AdminModel = {
      type: 'object',
      properties: {
        id: { type: 'string', readOnly: true, example: 'admin_123' },
        email: { type: 'string', format: 'email', example: 'admin@nodestack.io' },
        avatar: { type: 'string', nullable: true },
        created: { type: 'string', format: 'date-time', readOnly: true },
        updated: { type: 'string', format: 'date-time', readOnly: true },
      },
      required: ['id', 'email'],
    };

    schemas.AdminAuthResponse = {
      type: 'object',
      properties: {
        token: { type: 'string', description: 'JWT authentication token' },
        admin: { $ref: '#/components/schemas/AdminModel' },
      },
      required: ['token', 'admin'],
    };

    schemas.AuthWithPasswordRequest = {
      type: 'object',
      properties: {
        identity: { type: 'string', description: 'Email address or username', example: 'user@example.com' },
        password: { type: 'string', format: 'password', example: 'supersecret123' },
      },
      required: ['identity', 'password'],
    };

    schemas.CreateInitialAdminRequest = {
      type: 'object',
      properties: {
        email: { type: 'string', format: 'email', example: 'admin@example.com' },
        password: { type: 'string', format: 'password', example: 'supersecret123' },
      },
      required: ['email', 'password'],
    };

    schemas.HealthResponse = {
      type: 'object',
      properties: {
        status: { type: 'string', example: 'ok' },
        version: { type: 'string', example: '0.1.0' },
        appName: { type: 'string', example: 'NodeStack' },
        uptime: { type: 'number', example: 123.45 },
        memory: { type: 'object', additionalProperties: true },
      },
      required: ['status', 'version', 'appName'],
    };

    schemas.SettingsResponse = {
      type: 'object',
      properties: {
        appName: { type: 'string', example: 'NodeStack' },
        version: { type: 'string', example: '0.1.0' },
      },
      required: ['appName', 'version'],
    };

    schemas.LogEntry = {
      type: 'object',
      properties: {
        id: { type: 'string' },
        created: { type: 'string', format: 'date-time' },
        method: { type: 'string', example: 'GET' },
        url: { type: 'string', example: '/api/health' },
        status: { type: 'integer', example: 200 },
        duration: { type: 'number', example: 1.25 },
        ip: { type: 'string', example: '127.0.0.1' },
        authId: { type: 'string', nullable: true },
        authCollection: { type: 'string', nullable: true },
        userAgent: { type: 'string', nullable: true },
      },
    };

    schemas.LogListResult = {
      type: 'object',
      properties: {
        page: { type: 'integer', example: 1 },
        perPage: { type: 'integer', example: 50 },
        totalItems: { type: 'integer', example: 100 },
        totalPages: { type: 'integer', example: 2 },
        items: {
          type: 'array',
          items: { $ref: '#/components/schemas/LogEntry' },
        },
      },
      required: ['page', 'perPage', 'totalItems', 'totalPages', 'items'],
    };

    schemas.CollectionField = {
      type: 'object',
      properties: {
        id: { type: 'string' },
        name: { type: 'string' },
        type: {
          type: 'string',
          enum: ['text', 'number', 'bool', 'email', 'url', 'date', 'select', 'json', 'file', 'relation'],
        },
        required: { type: 'boolean' },
        unique: { type: 'boolean' },
        defaultValue: {},
        options: { type: 'object', additionalProperties: true },
      },
      required: ['name', 'type'],
    };

    schemas.CollectionModel = {
      type: 'object',
      properties: {
        id: { type: 'string', readOnly: true },
        name: { type: 'string' },
        type: { type: 'string', enum: ['base', 'auth', 'view'] },
        system: { type: 'boolean' },
        schema: {
          type: 'array',
          items: { $ref: '#/components/schemas/CollectionField' },
        },
        indexes: { type: 'array', items: { type: 'string' } },
        listRule: { type: 'string', nullable: true },
        viewRule: { type: 'string', nullable: true },
        createRule: { type: 'string', nullable: true },
        updateRule: { type: 'string', nullable: true },
        deleteRule: { type: 'string', nullable: true },
        options: { type: 'object' },
        created: { type: 'string', format: 'date-time', readOnly: true },
        updated: { type: 'string', format: 'date-time', readOnly: true },
      },
      required: ['name', 'type', 'schema'],
    };

    schemas.CollectionListResult = {
      type: 'object',
      properties: {
        items: {
          type: 'array',
          items: { $ref: '#/components/schemas/CollectionModel' },
        },
        totalItems: { type: 'integer' },
      },
      required: ['items', 'totalItems'],
    };

    // 2. Collection-Specific Schemas & Paths
    for (const col of collections) {
      const pascal = this.toPascalCase(col.name);
      const recordSchemaName = `${pascal}Record`;
      const createSchemaName = `${pascal}Create`;
      const updateSchemaName = `${pascal}Update`;
      const listSchemaName = `${pascal}ListResult`;
      const authResponseSchemaName = `${pascal}AuthResponse`;

      tags.push({
        name: col.name,
        description: `Operations for the '${col.name}' collection (${col.type} type)`,
      });

      // --- Build Record Properties ---
      const recordProps: Record<string, any> = {
        id: { type: 'string', readOnly: true, example: `r_${Math.random().toString(36).slice(2, 8)}` },
        created: { type: 'string', format: 'date-time', readOnly: true },
        updated: { type: 'string', format: 'date-time', readOnly: true },
      };

      const createProps: Record<string, any> = {};
      const updateProps: Record<string, any> = {};
      const multipartCreateProps: Record<string, any> = {};
      const createRequired: string[] = [];
      let hasFileFields = false;

      if (col.type === 'auth') {
        recordProps.email = { type: 'string', format: 'email', example: 'user@example.com' };
        recordProps.emailVisibility = { type: 'boolean', default: false };
        recordProps.verified = { type: 'boolean', readOnly: true, default: false };

        createProps.email = { type: 'string', format: 'email', example: 'user@example.com' };
        createProps.password = { type: 'string', format: 'password', writeOnly: true, minLength: 8 };
        createProps.passwordConfirm = { type: 'string', format: 'password', writeOnly: true };
        createRequired.push('email', 'password');

        updateProps.email = { type: 'string', format: 'email' };
        updateProps.password = { type: 'string', format: 'password', writeOnly: true, minLength: 8 };
        updateProps.passwordConfirm = { type: 'string', format: 'password', writeOnly: true };
        updateProps.emailVisibility = { type: 'boolean' };
      }

      const systemFieldsToSkip = new Set(['id', 'created', 'updated']);
      if (col.type === 'auth') {
        systemFieldsToSkip.add('email');
        systemFieldsToSkip.add('emailVisibility');
        systemFieldsToSkip.add('verified');
        systemFieldsToSkip.add('passwordHash');
        systemFieldsToSkip.add('tokenKey');
      }

      for (const field of col.schema) {
        if (systemFieldsToSkip.has(field.name)) continue;

        const openApiField = this.mapFieldToOpenApi(field);
        recordProps[field.name] = openApiField;
        createProps[field.name] = openApiField;
        updateProps[field.name] = openApiField;

        if (field.type === 'file') {
          hasFileFields = true;
          const isMulti = Boolean(field.options?.maxSelect && field.options.maxSelect > 1);
          multipartCreateProps[field.name] = isMulti
            ? { type: 'array', items: { type: 'string', format: 'binary' } }
            : { type: 'string', format: 'binary' };
        } else {
          multipartCreateProps[field.name] = openApiField;
        }

        if (field.required) {
          createRequired.push(field.name);
        }
      }

      // Record schema includes optional expand property
      recordProps.expand = {
        type: 'object',
        additionalProperties: true,
        description: 'Expanded relations if requested via the ?expand query parameter',
      };

      schemas[recordSchemaName] = {
        type: 'object',
        properties: recordProps,
        required: ['id', 'created', 'updated'],
      };

      schemas[createSchemaName] = {
        type: 'object',
        properties: createProps,
        ...(createRequired.length > 0 ? { required: createRequired } : {}),
      };

      schemas[updateSchemaName] = {
        type: 'object',
        properties: updateProps,
      };

      schemas[listSchemaName] = {
        type: 'object',
        properties: {
          page: { type: 'integer', example: 1 },
          perPage: { type: 'integer', example: 30 },
          totalItems: { type: 'integer', example: 1 },
          totalPages: { type: 'integer', example: 1 },
          items: {
            type: 'array',
            items: { $ref: `#/components/schemas/${recordSchemaName}` },
          },
        },
        required: ['page', 'perPage', 'totalItems', 'totalPages', 'items'],
      };

      if (col.type === 'auth') {
        schemas[authResponseSchemaName] = {
          type: 'object',
          properties: {
            token: { type: 'string', description: 'JWT authentication token' },
            record: { $ref: `#/components/schemas/${recordSchemaName}` },
          },
          required: ['token', 'record'],
        };
      }

      // --- Paths for this collection ---
      const recordsPath = `/api/collections/${col.name}/records`;
      const recordItemPath = `/api/collections/${col.name}/records/{id}`;

      // 1. List Records (GET)
      paths[recordsPath] = paths[recordsPath] || {};
      paths[recordsPath].get = {
        tags: [col.name],
        summary: `List ${col.name} records`,
        description: `Returns a paginated list of **${col.name}** records.\n\n**Access Rule:** ${this.describeRule(col.listRule)}`,
        security: [{ BearerAuth: [] }, {}],
        parameters: [
          {
            name: 'page',
            in: 'query',
            schema: { type: 'integer', default: 1, minimum: 1 },
            description: 'Page number',
          },
          {
            name: 'perPage',
            in: 'query',
            schema: { type: 'integer', default: 30, minimum: 1, maximum: 500 },
            description: 'Number of records per page',
          },
          {
            name: 'sort',
            in: 'query',
            schema: { type: 'string' },
            description: 'Fields to sort by. Prefix with - for descending order (e.g. `-created,title`).',
          },
          {
            name: 'filter',
            in: 'query',
            schema: { type: 'string' },
            description: 'Filter expression (e.g. `status = "active" && views > 10`).',
          },
          {
            name: 'expand',
            in: 'query',
            schema: { type: 'string' },
            description: 'Comma-separated relation field names to expand.',
          },
          {
            name: 'fields',
            in: 'query',
            schema: { type: 'string' },
            description: 'Comma-separated field names to return.',
          },
        ],
        responses: {
          '200': {
            description: `List of ${col.name} records`,
            content: {
              'application/json': {
                schema: { $ref: `#/components/schemas/${listSchemaName}` },
              },
            },
          },
          '400': {
            description: 'Invalid query parameters or filter syntax',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/ErrorResponse' },
              },
            },
          },
          '403': {
            description: 'Forbidden by access rule',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/ErrorResponse' },
              },
            },
          },
        },
      };

      // 2. Create Record (POST)
      const postRequestContent: Record<string, any> = {
        'application/json': {
          schema: { $ref: `#/components/schemas/${createSchemaName}` },
        },
      };

      if (hasFileFields) {
        postRequestContent['multipart/form-data'] = {
          schema: {
            type: 'object',
            properties: multipartCreateProps,
            ...(createRequired.length > 0 ? { required: createRequired } : {}),
          },
        };
      }

      paths[recordsPath].post = {
        tags: [col.name],
        summary: `Create ${col.name} record`,
        description: `Creates a new record in **${col.name}**.\n\n**Access Rule:** ${this.describeRule(col.createRule)}`,
        security: [{ BearerAuth: [] }, {}],
        requestBody: {
          required: true,
          content: postRequestContent,
        },
        responses: {
          '201': {
            description: 'Record successfully created',
            content: {
              'application/json': {
                schema: { $ref: `#/components/schemas/${recordSchemaName}` },
              },
            },
          },
          '400': {
            description: 'Validation failed or missing required fields',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/ErrorResponse' },
              },
            },
          },
          '403': {
            description: 'Forbidden by access rule',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/ErrorResponse' },
              },
            },
          },
        },
      };

      // 3. Get One Record (GET)
      paths[recordItemPath] = paths[recordItemPath] || {};
      paths[recordItemPath].get = {
        tags: [col.name],
        summary: `Get ${col.name} record by ID`,
        description: `Retrieves a single **${col.name}** record by its unique ID.\n\n**Access Rule:** ${this.describeRule(col.viewRule)}`,
        security: [{ BearerAuth: [] }, {}],
        parameters: [
          {
            name: 'id',
            in: 'path',
            required: true,
            schema: { type: 'string' },
            description: 'Unique record identifier',
          },
          {
            name: 'expand',
            in: 'query',
            schema: { type: 'string' },
            description: 'Comma-separated relation field names to expand.',
          },
          {
            name: 'fields',
            in: 'query',
            schema: { type: 'string' },
            description: 'Comma-separated field names to return.',
          },
        ],
        responses: {
          '200': {
            description: 'Record retrieved successfully',
            content: {
              'application/json': {
                schema: { $ref: `#/components/schemas/${recordSchemaName}` },
              },
            },
          },
          '403': {
            description: 'Forbidden by access rule',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/ErrorResponse' },
              },
            },
          },
          '404': {
            description: 'Record not found',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/ErrorResponse' },
              },
            },
          },
        },
      };

      // 4. Update Record (PATCH)
      const patchRequestContent: Record<string, any> = {
        'application/json': {
          schema: { $ref: `#/components/schemas/${updateSchemaName}` },
        },
      };

      if (hasFileFields) {
        patchRequestContent['multipart/form-data'] = {
          schema: {
            type: 'object',
            properties: multipartCreateProps,
          },
        };
      }

      paths[recordItemPath].patch = {
        tags: [col.name],
        summary: `Update ${col.name} record`,
        description: `Partially updates an existing **${col.name}** record.\n\n**Access Rule:** ${this.describeRule(col.updateRule)}`,
        security: [{ BearerAuth: [] }, {}],
        parameters: [
          {
            name: 'id',
            in: 'path',
            required: true,
            schema: { type: 'string' },
            description: 'Unique record identifier',
          },
        ],
        requestBody: {
          required: true,
          content: patchRequestContent,
        },
        responses: {
          '200': {
            description: 'Record updated successfully',
            content: {
              'application/json': {
                schema: { $ref: `#/components/schemas/${recordSchemaName}` },
              },
            },
          },
          '400': {
            description: 'Validation failed',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/ErrorResponse' },
              },
            },
          },
          '403': {
            description: 'Forbidden by access rule',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/ErrorResponse' },
              },
            },
          },
          '404': {
            description: 'Record not found',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/ErrorResponse' },
              },
            },
          },
        },
      };

      // 5. Delete Record (DELETE)
      paths[recordItemPath].delete = {
        tags: [col.name],
        summary: `Delete ${col.name} record`,
        description: `Deletes a single **${col.name}** record.\n\n**Access Rule:** ${this.describeRule(col.deleteRule)}`,
        security: [{ BearerAuth: [] }, {}],
        parameters: [
          {
            name: 'id',
            in: 'path',
            required: true,
            schema: { type: 'string' },
            description: 'Unique record identifier',
          },
        ],
        responses: {
          '204': {
            description: 'Record successfully deleted (No Content)',
          },
          '403': {
            description: 'Forbidden by access rule',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/ErrorResponse' },
              },
            },
          },
          '404': {
            description: 'Record not found',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/ErrorResponse' },
              },
            },
          },
        },
      };

      // 6. Auth collection login route
      if (col.type === 'auth') {
        const authPath = `/api/collections/${col.name}/auth-with-password`;
        paths[authPath] = paths[authPath] || {};
        paths[authPath].post = {
          tags: ['Auth', col.name],
          summary: `Authenticate ${col.name} record with password`,
          description: `Authenticates an account in the **${col.name}** collection using email/identity and password. Returns a signed JWT token.`,
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/AuthWithPasswordRequest' },
              },
            },
          },
          responses: {
            '200': {
              description: 'Authentication successful',
              content: {
                'application/json': {
                  schema: { $ref: `#/components/schemas/${authResponseSchemaName}` },
                },
              },
            },
            '400': {
              description: 'Invalid credentials or missing fields',
              content: {
                'application/json': {
                  schema: { $ref: '#/components/schemas/ErrorResponse' },
                },
              },
            },
          },
        };
      }
    }

    // 3. Auth Core Endpoints
    tags.push({ name: 'Auth', description: 'Admin and user authentication endpoints' });

    paths['/api/admins/has-admins'] = {
      get: {
        tags: ['Auth'],
        summary: 'Check if initial superuser exists',
        description: 'Returns whether at least one superuser/admin account has been created.',
        responses: {
          '200': {
            description: 'Check status',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: { hasAdmins: { type: 'boolean' } },
                  required: ['hasAdmins'],
                },
              },
            },
          },
        },
      },
    };

    paths['/api/admins/create-initial'] = {
      post: {
        tags: ['Auth'],
        summary: 'Create initial superuser account',
        description: 'Creates the initial superuser account. Only available if no admins exist.',
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: { $ref: '#/components/schemas/CreateInitialAdminRequest' },
            },
          },
        },
        responses: {
          '201': {
            description: 'Superuser created and logged in',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/AdminAuthResponse' },
              },
            },
          },
          '400': {
            description: 'Admin already initialized or validation error',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/ErrorResponse' },
              },
            },
          },
        },
      },
    };

    paths['/api/admins/auth-with-password'] = {
      post: {
        tags: ['Auth'],
        summary: 'Superuser / Admin login',
        description: 'Authenticates a superuser with email and password, returning a JWT token.',
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: { $ref: '#/components/schemas/AuthWithPasswordRequest' },
            },
          },
        },
        responses: {
          '200': {
            description: 'Login successful',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/AdminAuthResponse' },
              },
            },
          },
          '400': {
            description: 'Invalid credentials',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/ErrorResponse' },
              },
            },
          },
        },
      },
    };

    paths['/api/admins/me'] = {
      get: {
        tags: ['Auth'],
        summary: 'Get current logged-in superuser',
        description: 'Returns profile details for the authenticated superuser.',
        security: [{ BearerAuth: [] }],
        responses: {
          '200': {
            description: 'Current superuser details',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/AdminModel' },
              },
            },
          },
          '401': {
            description: 'Unauthorized or missing superuser token',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/ErrorResponse' },
              },
            },
          },
        },
      },
    };

    // 4. Schema Collections Management Endpoints
    tags.push({ name: 'Collections', description: 'Collection schema management (Admin only)' });

    paths['/api/collections'] = {
      get: {
        tags: ['Collections'],
        summary: 'List all collections',
        description: 'Lists all collection schemas currently defined in NodeStack.',
        security: [{ BearerAuth: [] }],
        responses: {
          '200': {
            description: 'List of collections',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/CollectionListResult' },
              },
            },
          },
          '401': { description: 'Unauthorized' },
        },
      },
      post: {
        tags: ['Collections'],
        summary: 'Create a new collection',
        description: 'Creates a new collection schema and underlying SQLite table.',
        security: [{ BearerAuth: [] }],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: { $ref: '#/components/schemas/CollectionModel' },
            },
          },
        },
        responses: {
          '201': {
            description: 'Collection created',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/CollectionModel' },
              },
            },
          },
          '400': { description: 'Validation failed' },
          '401': { description: 'Unauthorized' },
        },
      },
    };

    paths['/api/collections/{collection}'] = {
      get: {
        tags: ['Collections'],
        summary: 'Get collection details',
        description: 'Returns schema definition for a specific collection.',
        security: [{ BearerAuth: [] }],
        parameters: [
          { name: 'collection', in: 'path', required: true, schema: { type: 'string' } },
        ],
        responses: {
          '200': {
            description: 'Collection details',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/CollectionModel' },
              },
            },
          },
          '404': { description: 'Collection not found' },
        },
      },
      patch: {
        tags: ['Collections'],
        summary: 'Update collection schema',
        description: 'Updates schema fields, rules, and indexes for an existing collection.',
        security: [{ BearerAuth: [] }],
        parameters: [
          { name: 'collection', in: 'path', required: true, schema: { type: 'string' } },
        ],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: { $ref: '#/components/schemas/CollectionModel' },
            },
          },
        },
        responses: {
          '200': {
            description: 'Collection updated',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/CollectionModel' },
              },
            },
          },
          '400': { description: 'Invalid schema update' },
          '404': { description: 'Collection not found' },
        },
      },
      delete: {
        tags: ['Collections'],
        summary: 'Delete collection',
        description: 'Permanently deletes a collection and drops its SQLite table.',
        security: [{ BearerAuth: [] }],
        parameters: [
          { name: 'collection', in: 'path', required: true, schema: { type: 'string' } },
        ],
        responses: {
          '204': { description: 'Collection deleted' },
          '400': { description: 'Cannot delete system collection' },
          '404': { description: 'Collection not found' },
        },
      },
    };

    // 5. File Storage Endpoints
    tags.push({ name: 'Files', description: 'File serving and download endpoints' });

    paths['/api/files/{collection}/{recordId}/{filename}'] = {
      get: {
        tags: ['Files'],
        summary: 'Download / view file',
        description: 'Downloads or displays a file stored in a record. Access is controlled by the collection `viewRule`.',
        parameters: [
          { name: 'collection', in: 'path', required: true, schema: { type: 'string' } },
          { name: 'recordId', in: 'path', required: true, schema: { type: 'string' } },
          { name: 'filename', in: 'path', required: true, schema: { type: 'string' } },
          {
            name: 'download',
            in: 'query',
            schema: { type: 'string', enum: ['0', '1'] },
            description: 'Set to 1 to force browser attachment download.',
          },
        ],
        responses: {
          '200': {
            description: 'File stream content',
            content: {
              '*/*': {
                schema: { type: 'string', format: 'binary' },
              },
            },
          },
          '403': { description: 'Forbidden by access rule' },
          '404': { description: 'File or record not found' },
        },
      },
    };

    // 6. Realtime Endpoints
    tags.push({ name: 'Realtime', description: 'Realtime Server-Sent Events (SSE) streaming' });

    paths['/api/realtime'] = {
      get: {
        tags: ['Realtime'],
        summary: 'Connect to Realtime SSE event stream',
        description: 'Establishes a persistent Server-Sent Events (SSE) connection for real-time record updates.',
        security: [{ BearerAuth: [] }, {}],
        responses: {
          '200': {
            description: 'SSE stream connection established',
            content: {
              'text/event-stream': {
                schema: { type: 'string' },
              },
            },
          },
        },
      },
      post: {
        tags: ['Realtime'],
        summary: 'Set client subscriptions',
        description: 'Configures collection subscriptions for an active realtime connection.',
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  clientId: { type: 'string', example: 'client_xyz' },
                  subscriptions: {
                    type: 'array',
                    items: { type: 'string' },
                    example: ['posts', 'users'],
                  },
                },
                required: ['clientId', 'subscriptions'],
              },
            },
          },
        },
        responses: {
          '204': { description: 'Subscriptions configured' },
          '404': { description: 'Client disconnected or not found' },
        },
      },
    };

    // 7. System Endpoints
    tags.push({ name: 'System', description: 'System health, logs, settings, and developer utilities' });

    paths['/api/health'] = {
      get: {
        tags: ['System'],
        summary: 'Health check',
        description: 'Returns server status, version, uptime, and memory usage metrics.',
        responses: {
          '200': {
            description: 'Server is healthy',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/HealthResponse' },
              },
            },
          },
        },
      },
    };

    paths['/api/settings'] = {
      get: {
        tags: ['System'],
        summary: 'Application settings',
        description: 'Returns basic server configuration details.',
        responses: {
          '200': {
            description: 'Settings information',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/SettingsResponse' },
              },
            },
          },
        },
      },
    };

    paths['/api/logs'] = {
      get: {
        tags: ['System'],
        summary: 'Request logs & traffic',
        description: 'Returns recent HTTP request audit logs (Admin only).',
        security: [{ BearerAuth: [] }],
        parameters: [
          { name: 'page', in: 'query', schema: { type: 'integer', default: 1 } },
          { name: 'perPage', in: 'query', schema: { type: 'integer', default: 50 } },
        ],
        responses: {
          '200': {
            description: 'Log entries',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/LogListResult' },
              },
            },
          },
          '401': { description: 'Unauthorized' },
        },
      },
      delete: {
        tags: ['System'],
        summary: 'Clear request logs',
        description: 'Truncates the request audit log history table (Admin only).',
        security: [{ BearerAuth: [] }],
        responses: {
          '204': { description: 'Logs cleared successfully' },
          '401': { description: 'Unauthorized' },
        },
      },
    };

    paths['/api/types'] = {
      get: {
        tags: ['System'],
        summary: 'Get TypeScript type definitions',
        description: 'Returns TypeScript interface definitions generated from the current SQLite collection schema.',
        responses: {
          '200': {
            description: 'TypeScript definitions',
            content: {
              'text/plain': {
                schema: { type: 'string' },
              },
            },
          },
        },
      },
    };

    paths['/api/openapi.json'] = {
      get: {
        tags: ['System'],
        summary: 'OpenAPI 3.0 specification JSON',
        description: 'Returns this OpenAPI 3.0 specification in JSON format.',
        responses: {
          '200': {
            description: 'OpenAPI 3.0 specification object',
            content: {
              'application/json': {
                schema: { type: 'object' },
              },
            },
          },
        },
      },
    };

    // Construct final OpenAPI document
    return {
      openapi: '3.0.3',
      info: {
        title,
        version,
        description,
      },
      servers: [
        {
          url: serverUrl,
          description: 'NodeStack Server',
        },
      ],
      tags,
      paths,
      components: {
        securitySchemes: {
          BearerAuth: {
            type: 'http',
            scheme: 'bearer',
            bearerFormat: 'JWT',
            description:
              'JWT authorization token. Provide your token obtained from `/api/admins/auth-with-password` or `/api/collections/{collection}/auth-with-password`.',
          },
        },
        schemas,
      },
    };
  }

  private static mapFieldToOpenApi(field: SchemaField): Record<string, any> {
    const isMulti = Boolean(field.options?.maxSelect && field.options.maxSelect > 1);

    let baseSchema: Record<string, any> = {};

    switch (field.type) {
      case 'text':
        baseSchema = { type: 'string' };
        if (field.defaultValue !== undefined && field.defaultValue !== null) {
          baseSchema.default = field.defaultValue;
        }
        break;
      case 'number':
        baseSchema = { type: 'number' };
        if (field.defaultValue !== undefined && field.defaultValue !== null) {
          baseSchema.default = Number(field.defaultValue);
        }
        if (field.options?.min !== undefined) baseSchema.minimum = field.options.min;
        if (field.options?.max !== undefined) baseSchema.maximum = field.options.max;
        break;
      case 'bool':
        baseSchema = { type: 'boolean' };
        if (field.defaultValue !== undefined && field.defaultValue !== null) {
          baseSchema.default = Boolean(field.defaultValue);
        }
        break;
      case 'email':
        baseSchema = { type: 'string', format: 'email' };
        break;
      case 'url':
        baseSchema = { type: 'string', format: 'uri' };
        break;
      case 'date':
        baseSchema = { type: 'string', format: 'date-time' };
        break;
      case 'select': {
        const values = Array.isArray(field.options?.values) ? field.options.values : [];
        if (isMulti) {
          return {
            type: 'array',
            items: { type: 'string', ...(values.length > 0 ? { enum: values } : {}) },
          };
        }
        return {
          type: 'string',
          ...(values.length > 0 ? { enum: values } : {}),
          ...(field.defaultValue !== undefined ? { default: field.defaultValue } : {}),
        };
      }
      case 'json':
        return { type: 'object', additionalProperties: true };
      case 'file':
        if (isMulti) {
          return {
            type: 'array',
            items: { type: 'string', description: 'Stored file filename' },
          };
        }
        return { type: 'string', description: 'Stored file filename' };
      case 'relation':
        if (isMulti) {
          return {
            type: 'array',
            items: { type: 'string' },
            description: `Array of target record IDs (Collection: '${field.options?.collectionId || 'unknown'}')`,
          };
        }
        return {
          type: 'string',
          description: `Target record ID (Collection: '${field.options?.collectionId || 'unknown'}')`,
        };
      default:
        baseSchema = { type: 'string' };
    }

    if (isMulti) {
      return {
        type: 'array',
        items: baseSchema,
      };
    }

    return baseSchema;
  }

  private static describeRule(rule: string | null | undefined): string {
    if (rule === null || rule === undefined) {
      return '`Admin only` 🔒';
    }
    if (rule === '') {
      return '`Public` 🌐 (Anyone can perform this action)';
    }
    return `\`${rule}\` 🔑 (Requires authentication satisfying rule condition)`;
  }

  private static toPascalCase(str: string): string {
    if (!str) return 'Item';
    const cleaned = str.replace(/[^a-zA-Z0-9]+(.)/g, (_, chr) => chr.toUpperCase());
    const result = cleaned.charAt(0).toUpperCase() + cleaned.slice(1);
    return /^[a-zA-Z_$]/.test(result) ? result : `Col_${result}`;
  }
}
