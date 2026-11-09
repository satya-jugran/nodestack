import { IDatabaseDriver } from '../drivers/IDatabaseDriver';

export class SystemMigrations {
  public static run(driver: IDatabaseDriver): any {
    const dialect = driver.dialect;
    const pk = dialect.mapFieldType('text', { isPrimaryKey: true });
    const unq = dialect.mapFieldType('text', { isUnique: true });
    const idx = dialect.mapFieldType('text', { isIndexed: true });
    const txt = dialect.mapFieldType('text');
    const bool = dialect.mapFieldType('bool');
    const num = dialect.mapFieldType('number');
    const date = dialect.mapFieldType('date');

    const statements: string[] = [
      dialect.createTableIfNotExists('_collections', `
        id ${pk} PRIMARY KEY,
        name ${unq} UNIQUE NOT NULL,
        type ${txt} NOT NULL DEFAULT 'base',
        system ${bool} NOT NULL DEFAULT ${dialect.booleanLiteral(false)},
        schema ${txt} NOT NULL DEFAULT '[]',
        indexes ${txt} NOT NULL DEFAULT '[]',
        listRule ${txt},
        viewRule ${txt},
        createRule ${txt},
        updateRule ${txt},
        deleteRule ${txt},
        options ${txt} NOT NULL DEFAULT '{}',
        created ${date} NOT NULL,
        updated ${date} NOT NULL
      `),
      dialect.createTableIfNotExists('_admins', `
        id ${pk} PRIMARY KEY,
        email ${unq} UNIQUE NOT NULL,
        passwordHash ${txt} NOT NULL,
        tokenKey ${txt} NOT NULL,
        avatar ${txt},
        created ${date} NOT NULL,
        updated ${date} NOT NULL
      `),
      dialect.createTableIfNotExists('_logs', `
        id ${pk} PRIMARY KEY,
        method ${txt} NOT NULL,
        url ${txt} NOT NULL,
        status ${num} NOT NULL,
        duration ${num} NOT NULL,
        ip ${txt},
        authId ${txt},
        authCollection ${txt},
        userAgent ${txt},
        data ${txt},
        created ${date} NOT NULL
      `),
      dialect.createIndexIfNotExists('idx_logs_created', '_logs', 'created DESC'),
      dialect.createTableIfNotExists('_params', `
        key ${pk} PRIMARY KEY,
        value ${txt} NOT NULL
      `),
      dialect.createTableIfNotExists('_audit_logs', `
        id ${pk} PRIMARY KEY,
        collection ${idx} NOT NULL,
        recordId ${idx} NOT NULL,
        action ${idx} NOT NULL,
        diff ${txt} NOT NULL,
        changedFields ${txt} NOT NULL,
        authId ${txt},
        authEmail ${txt},
        authCollection ${txt},
        isAdmin ${bool} NOT NULL DEFAULT ${dialect.booleanLiteral(false)},
        ip ${txt},
        userAgent ${txt},
        created ${date} NOT NULL
      `),
      dialect.createIndexIfNotExists('idx_audit_record', '_audit_logs', 'collection, recordId, created DESC'),
      dialect.createIndexIfNotExists('idx_audit_created', '_audit_logs', 'created DESC'),
      dialect.createIndexIfNotExists('idx_audit_action', '_audit_logs', 'action'),
      dialect.createTableIfNotExists('_webhooks', `
        id ${pk} PRIMARY KEY,
        name ${txt} NOT NULL,
        url ${txt} NOT NULL,
        event ${txt} NOT NULL,
        collection ${idx} NOT NULL,
        action ${txt} NOT NULL DEFAULT '*',
        method ${txt} NOT NULL DEFAULT 'POST',
        headers ${txt},
        secret ${txt},
        enabled ${bool} NOT NULL DEFAULT ${dialect.booleanLiteral(true)},
        created ${date} NOT NULL,
        updated ${date} NOT NULL
      `),
      dialect.createIndexIfNotExists('idx_webhooks_collection', '_webhooks', 'collection'),
      dialect.createIndexIfNotExists('idx_webhooks_enabled', '_webhooks', 'enabled'),
      dialect.createTableIfNotExists('_webhook_deliveries', `
        id ${pk} PRIMARY KEY,
        webhookId ${idx} NOT NULL,
        webhookName ${txt} NOT NULL,
        url ${txt} NOT NULL,
        event ${txt} NOT NULL,
        collection ${txt} NOT NULL,
        recordId ${txt},
        requestHeaders ${txt} NOT NULL,
        requestPayload ${txt} NOT NULL,
        responseStatus ${num} NOT NULL DEFAULT 0,
        responseHeaders ${txt},
        responseBody ${txt},
        durationMs ${num} NOT NULL DEFAULT 0,
        status ${idx} NOT NULL,
        error ${txt},
        attempt ${num} NOT NULL DEFAULT 1,
        created ${date} NOT NULL
      `),
      dialect.createIndexIfNotExists('idx_webhook_del_wh', '_webhook_deliveries', 'webhookId, created DESC'),
      dialect.createIndexIfNotExists('idx_webhook_del_created', '_webhook_deliveries', 'created DESC'),
      dialect.createIndexIfNotExists('idx_webhook_del_status', '_webhook_deliveries', 'status'),
      dialect.createTableIfNotExists('_external_auths', `
        id ${pk} PRIMARY KEY,
        collection ${idx} NOT NULL,
        recordId ${idx} NOT NULL,
        provider ${idx} NOT NULL,
        providerUserId ${idx} NOT NULL,
        email ${txt},
        created ${date} NOT NULL,
        updated ${date} NOT NULL,
        UNIQUE(collection, provider, providerUserId)
      `),
      dialect.createIndexIfNotExists('idx_ext_auth_rec', '_external_auths', 'collection, recordId'),
      dialect.createIndexIfNotExists('idx_ext_auth_prov', '_external_auths', 'provider, providerUserId'),
      dialect.createTableIfNotExists('_api_keys', `
        id ${pk} PRIMARY KEY,
        name ${txt} NOT NULL,
        description ${txt},
        keyPrefix ${unq} NOT NULL,
        secretHash ${txt} NOT NULL,
        redactedKey ${txt} NOT NULL,
        role ${txt} NOT NULL DEFAULT 'service',
        scopes ${txt} NOT NULL DEFAULT '[]',
        allowedIps ${txt} NOT NULL DEFAULT '[]',
        expiresAt ${txt},
        lastUsedAt ${txt},
        lastUsedIp ${txt},
        totalRequests ${num} NOT NULL DEFAULT 0,
        status ${idx} NOT NULL DEFAULT 'active',
        createdBy ${txt},
        created ${date} NOT NULL,
        updated ${date} NOT NULL
      `),
      dialect.createIndexIfNotExists('idx_api_keys_prefix', '_api_keys', 'keyPrefix', true),
      dialect.createIndexIfNotExists('idx_api_keys_status', '_api_keys', 'status'),
      dialect.createTableIfNotExists('_queues', `
        name ${pk} PRIMARY KEY,
        concurrency ${num} NOT NULL DEFAULT 0,
        visibilityTimeoutSeconds ${num} NOT NULL DEFAULT 30,
        maxAttempts ${num} NOT NULL DEFAULT 3,
        backoffDelayMs ${num} NOT NULL DEFAULT 1000,
        deadLetterQueue ${txt},
        targetFunction ${txt},
        isSystem ${num} NOT NULL DEFAULT 0,
        strictOrder ${num} NOT NULL DEFAULT 0,
        created ${date} NOT NULL,
        updated ${date} NOT NULL
      `),
      dialect.createTableIfNotExists('_queue_messages', `
        id ${pk} PRIMARY KEY,
        queue ${idx} NOT NULL,
        groupKey ${txt},
        status ${idx} NOT NULL DEFAULT 'queued',
        payload ${txt},
        result ${txt},
        error ${txt},
        attempts ${num} NOT NULL DEFAULT 0,
        maxAttempts ${num} NOT NULL DEFAULT 3,
        priority ${num} NOT NULL DEFAULT 0,
        availableAt ${date} NOT NULL,
        claimedBy ${txt},
        leaseExpiresAt ${date},
        claimToken ${txt},
        deduplicationId ${txt},
        originalMessageId ${txt},
        forwardedToMessageId ${txt},
        created ${date} NOT NULL,
        updated ${date} NOT NULL,
        finishedAt ${date}
      `),
      dialect.createIndexIfNotExists('idx_qmsg_poll', '_queue_messages', 'queue, status, availableAt'),
      dialect.createIndexIfNotExists('idx_qmsg_group', '_queue_messages', 'groupKey, status'),
      dialect.createIndexIfNotExists('idx_qmsg_cleanup', '_queue_messages', 'status, finishedAt'),
      dialect.createIndexIfNotExists('idx_qmsg_dedup', '_queue_messages', 'queue, deduplicationId'),
      dialect.createTableIfNotExists('_functions', `
        id ${pk} PRIMARY KEY,
        name ${unq} UNIQUE NOT NULL,
        description ${txt} DEFAULT '',
        code ${txt} NOT NULL,
        enabled ${num} NOT NULL DEFAULT 1,
        authPolicy ${txt} NOT NULL DEFAULT 'public',
        methods ${txt} NOT NULL DEFAULT 'GET,POST',
        eventTrigger ${txt},
        timeoutMs ${num} NOT NULL DEFAULT 1000,
        memoryLimitMb ${num} NOT NULL DEFAULT 32,
        allowedDomains ${txt} NOT NULL,
        elevated ${num} NOT NULL DEFAULT 0,
        env ${txt} NOT NULL,
        created ${date} NOT NULL,
        updated ${date} NOT NULL
      `),
      dialect.createTableIfNotExists('_function_logs', `
        id ${pk} PRIMARY KEY,
        functionId ${idx} NOT NULL,
        functionName ${txt} NOT NULL,
        trigger ${txt} NOT NULL,
        status ${idx} NOT NULL,
        statusCode ${num} NOT NULL,
        durationMs ${num} NOT NULL,
        requestPayload ${txt},
        responsePayload ${txt},
        logs ${txt},
        error ${txt},
        actorId ${txt},
        timestamp ${date} NOT NULL
      `),
      dialect.createIndexIfNotExists('idx_fnlogs_fn', '_function_logs', 'functionId, timestamp DESC'),
      dialect.createTableIfNotExists('_flows', `
        id ${pk} PRIMARY KEY,
        name ${unq} UNIQUE NOT NULL,
        description ${txt} DEFAULT '',
        enabled ${num} NOT NULL DEFAULT 1,
        triggerType ${txt} NOT NULL DEFAULT 'http',
        eventTrigger ${txt},
        maxConcurrentExecutions ${num},
        definition ${txt} NOT NULL,
        created ${date} NOT NULL,
        updated ${date} NOT NULL
      `),
      dialect.createTableIfNotExists('_flow_executions', `
        id ${pk} PRIMARY KEY,
        flowId ${idx} NOT NULL,
        flowName ${txt} NOT NULL,
        status ${idx} NOT NULL,
        input ${txt},
        output ${txt},
        error ${txt},
        errorName ${txt},
        errorCode ${txt},
        durationMs ${num} NOT NULL,
        stepLogs ${txt},
        actorId ${txt},
        actor ${txt},
        queuedAt ${date},
        jobId ${txt},
        startedAt ${date} NOT NULL,
        finishedAt ${date},
        checkpoint ${txt},
        claimToken ${txt}
      `),
      dialect.createIndexIfNotExists('idx_flow_exec_flow', '_flow_executions', 'flowId, startedAt DESC'),
      dialect.createIndexIfNotExists('idx_flow_exec_status', '_flow_executions', 'status'),
    ];

    const userSchema = JSON.stringify([
      { id: 'f_name', name: 'name', type: 'text', required: false, unique: false },
      {
        id: 'f_avatar',
        name: 'avatar',
        type: 'file',
        required: false,
        unique: false,
        options: {
          maxSelect: 1,
          maxSize: 5242880,
          mimeTypes: ['image/jpeg', 'image/png', 'image/webp', 'image/gif'],
        },
      },
    ]);
    const userOptions = JSON.stringify({
      allowEmailAuth: true,
      requireEmailVerification: false,
      minPasswordLength: 8,
    });
    const now = new Date().toISOString();

    const insertUserSql = `
      INSERT INTO _collections (
        id, name, type, system, schema, indexes, listRule, viewRule, createRule, updateRule, deleteRule, options, created, updated
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `;
    const createUsersTableSql = dialect.createTableIfNotExists(
      'users',
      `
      id ${pk} PRIMARY KEY,
      email ${unq} UNIQUE NOT NULL,
      emailVisibility ${bool} NOT NULL DEFAULT ${dialect.booleanLiteral(false)},
      verified ${bool} NOT NULL DEFAULT ${dialect.booleanLiteral(false)},
      passwordHash ${txt} NOT NULL,
      tokenKey ${txt} NOT NULL,
      name ${txt},
      avatar ${txt},
      created ${date} NOT NULL,
      updated ${date} NOT NULL
    `
    );

    if (dialect.name === 'sqlite') {
      return driver.transaction((txDriver) => {
        const d = txDriver || driver;
        for (const sql of statements) {
          d.exec(sql);
        }
        const usersExists = d.prepare('SELECT id FROM _collections WHERE name = ?').get('users');
        if (!usersExists) {
          d.prepare(insertUserSql).run(
            'c_users_default',
            'users',
            'auth',
            0,
            userSchema,
            '[]',
            '',
            '',
            '',
            'id = @request.auth.id',
            'id = @request.auth.id',
            userOptions,
            now,
            now
          );
          d.exec(createUsersTableSql);
        }
      });
    } else {
      return driver.transaction(async (txDriver) => {
        const d = txDriver || driver;
        for (const sql of statements) {
          await d.exec(sql);
        }
        const usersExists = await d.prepare('SELECT id FROM _collections WHERE name = ?').get('users');
        if (!usersExists) {
          await d.prepare(insertUserSql).run(
            'c_users_default',
            'users',
            'auth',
            0,
            userSchema,
            '[]',
            '',
            '',
            '',
            'id = @request.auth.id',
            'id = @request.auth.id',
            userOptions,
            now,
            now
          );
          await d.exec(createUsersTableSql);
        }
      });
    }
  }
}
