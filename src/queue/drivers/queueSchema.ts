import { DatabaseService } from '../../database/DatabaseService';

export async function ensureQueueSchema(db: DatabaseService): Promise<void> {
  const isSqlite = db.dialect.name === 'sqlite';

  if (isSqlite) {
    db.exec(`
      CREATE TABLE IF NOT EXISTS _queues (
        name TEXT PRIMARY KEY,
        concurrency INTEGER NOT NULL DEFAULT 0,
        visibilityTimeoutSeconds INTEGER NOT NULL DEFAULT 30,
        maxAttempts INTEGER NOT NULL DEFAULT 3,
        backoffDelayMs INTEGER NOT NULL DEFAULT 1000,
        deadLetterQueue TEXT DEFAULT NULL,
        targetFunction TEXT DEFAULT NULL,
        isSystem INTEGER NOT NULL DEFAULT 0,
        strictOrder INTEGER NOT NULL DEFAULT 0,
        created TEXT NOT NULL,
        updated TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS _queue_messages (
        id TEXT PRIMARY KEY,
        queue TEXT NOT NULL,
        groupKey TEXT DEFAULT NULL,
        status TEXT NOT NULL DEFAULT 'queued',
        payload TEXT,
        result TEXT DEFAULT NULL,
        error TEXT DEFAULT NULL,
        attempts INTEGER NOT NULL DEFAULT 0,
        maxAttempts INTEGER NOT NULL DEFAULT 3,
        priority INTEGER NOT NULL DEFAULT 0,
        availableAt TEXT NOT NULL,
        claimedBy TEXT DEFAULT NULL,
        leaseExpiresAt TEXT DEFAULT NULL,
        claimToken TEXT DEFAULT NULL,
        deduplicationId TEXT DEFAULT NULL,
        originalMessageId TEXT DEFAULT NULL,
        forwardedToMessageId TEXT DEFAULT NULL,
        created TEXT NOT NULL,
        updated TEXT NOT NULL,
        finishedAt TEXT DEFAULT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_qmsg_poll ON _queue_messages(queue, status, availableAt, priority DESC);
      CREATE INDEX IF NOT EXISTS idx_qmsg_group ON _queue_messages(groupKey, status);
      CREATE INDEX IF NOT EXISTS idx_qmsg_cleanup ON _queue_messages(status, finishedAt);
      CREATE INDEX IF NOT EXISTS idx_qmsg_dedup ON _queue_messages(queue, deduplicationId);
      CREATE INDEX IF NOT EXISTS idx_qmsg_strict_hol ON _queue_messages(queue, groupKey, status, created ASC);
    `);

    try {
      db.exec(`
        CREATE VIEW IF NOT EXISTS _queue_jobs AS SELECT * FROM _queue_messages;
        CREATE TRIGGER IF NOT EXISTS trg_queue_jobs_insert
        INSTEAD OF INSERT ON _queue_jobs
        BEGIN
          INSERT INTO _queue_messages (
            id, queue, groupKey, status, payload, result, error, attempts, maxAttempts, priority, availableAt, claimedBy, leaseExpiresAt, claimToken, deduplicationId, originalMessageId, forwardedToMessageId, created, updated, finishedAt
          ) VALUES (
            NEW.id, NEW.queue, NEW.groupKey, coalesce(NEW.status, 'queued'), NEW.payload, NEW.result, NEW.error, coalesce(NEW.attempts, 0), coalesce(NEW.maxAttempts, 3), coalesce(NEW.priority, 0), coalesce(NEW.availableAt, datetime('now')), NEW.claimedBy, NEW.leaseExpiresAt, NEW.claimToken, NEW.deduplicationId, NEW.originalMessageId, NEW.forwardedToMessageId, coalesce(NEW.created, datetime('now')), coalesce(NEW.updated, datetime('now')), NEW.finishedAt
          );
        END;
      `);
    } catch {}

    try { db.exec(`ALTER TABLE _queues ADD COLUMN strictOrder INTEGER NOT NULL DEFAULT 0;`); } catch {}
    try { db.exec(`ALTER TABLE _queues ADD COLUMN isSystem INTEGER NOT NULL DEFAULT 0;`); } catch {}
    try { db.exec(`UPDATE _queues SET isSystem = 1 WHERE name LIKE '_system:%' AND isSystem = 0;`); } catch {}
    try { db.exec(`ALTER TABLE _queue_messages ADD COLUMN claimToken TEXT DEFAULT NULL;`); } catch {}
    try { db.exec(`ALTER TABLE _queue_messages ADD COLUMN originalMessageId TEXT DEFAULT NULL;`); } catch {}
    try { db.exec(`ALTER TABLE _queue_messages ADD COLUMN forwardedToMessageId TEXT DEFAULT NULL;`); } catch {}
    try { db.exec(`CREATE INDEX IF NOT EXISTS idx_qmsg_orig_job ON _queue_messages(originalMessageId);`); } catch {}
    try { db.exec(`CREATE INDEX IF NOT EXISTS idx_qmsg_forwarded_to ON _queue_messages(forwardedToMessageId);`); } catch {}
  } else {
    const dialect = db.dialect;
    const pk = dialect.mapFieldType('text', { isPrimaryKey: true });
    const txt = dialect.mapFieldType('text');
    const num = dialect.mapFieldType('number');
    const date = dialect.mapFieldType('date');
    const idx = dialect.mapFieldType('text', { isIndexed: true });

    await db.exec(dialect.createTableIfNotExists('_queues', `
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
    `));

    await db.exec(dialect.createTableIfNotExists('_queue_messages', `
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
    `));

    await db.exec(dialect.createIndexIfNotExists('idx_qmsg_poll', '_queue_messages', 'queue, status, availableAt'));
    await db.exec(dialect.createIndexIfNotExists('idx_qmsg_group', '_queue_messages', 'groupKey, status'));
    await db.exec(dialect.createIndexIfNotExists('idx_qmsg_cleanup', '_queue_messages', 'status, finishedAt'));
    await db.exec(dialect.createIndexIfNotExists('idx_qmsg_dedup', '_queue_messages', 'queue, deduplicationId'));

    try {
      await db.exec(`CREATE VIEW _queue_jobs AS SELECT * FROM _queue_messages;`);
    } catch {}
  }
}
