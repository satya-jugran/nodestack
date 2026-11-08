import { Command } from 'commander';
import chalk from 'chalk';
import * as readline from 'readline';
import { NodeStack } from '../NodeStack';
import { DriverRegistry, DatabaseConfig } from '../database/drivers/DriverRegistry';
import { DatabaseMigrationService } from '../database/migration/DatabaseMigrationService';

export async function runCli(argv = process.argv): Promise<Command | undefined> {
  const program = new Command();

  program
    .name('nodestack')
    .description('NodeStack — The TypeScript-Native Embedded Backend Stack')
    .version('2.4.0');

  // Command: start / serve
  program
    .command('start', { isDefault: true })
    .alias('serve')
    .description('Starts the NodeStack web server and Admin UI')
    .option('-d, --dir <path>', 'The directory where data and uploads are stored', './nodestack_data')
    .option('-h, --http <address>', 'Server bind address (host:port)', '0.0.0.0:8090')
    .option('--dev', 'Run in development mode with verbose error traces', false)
    .option('--mock-delay <ms>', 'Simulate network latency in milliseconds across API requests (e.g. 1500)')
    .option('--mock-fail-rate <rate>', 'Simulate random network drop rate between 0.0 and 1.0 (e.g. 0.2 for 20%)')
    .option('--mock-error <code>', 'Simulate HTTP error status code for network drops (e.g. 500 or 503)')
    .option('--mock-jitter <ms>', 'Simulate latency variance / jitter in milliseconds')
    .option('-t, --template <name>', 'Pre-seed database with a starter template (ecommerce, blog, crm)')
    .option('--overwrite', 'Overwrite existing collections if they exist when applying template', false)
    .action(async (options) => {
      let host = process.env.NODESTACK_HOST || process.env.HOST || '0.0.0.0';
      const envPort = process.env.NODESTACK_PORT || process.env.PORT;
      let port = envPort ? parseInt(envPort, 10) : 8090;

      if (options.http && options.http !== '0.0.0.0:8090') {
        if (options.http.includes(':')) {
          const parts = options.http.split(':');
          host = parts[0] || host;
          port = parseInt(parts[1], 10) || port;
        } else if (!isNaN(Number(options.http))) {
          port = Number(options.http);
        }
      }

      const effectiveDataDir = (options.dir === './nodestack_data' && process.env.NODESTACK_DATA_DIR)
        ? process.env.NODESTACK_DATA_DIR
        : options.dir;

      const app = new NodeStack({
        dataDir: effectiveDataDir,
        host,
        port,
        dev: options.dev,
        mockDelay: options.mockDelay,
        mockFailRate: options.mockFailRate !== undefined ? parseFloat(options.mockFailRate) : undefined,
        mockError: options.mockError !== undefined ? (!isNaN(Number(options.mockError)) ? Number(options.mockError) : options.mockError) : undefined,
        mockJitter: options.mockJitter !== undefined ? parseFloat(options.mockJitter) : undefined,
      });

      // Apply starter template if specified
      if (options.template) {
        try {
          const res = await app.templates.apply(options.template, {
            overwrite: Boolean(options.overwrite),
          });
          if (res.skipped) {
            console.log(
              chalk.yellow(
                `\n  ℹ Starter template '${res.templateName}' is already applied. (Use --overwrite to re-create)`
              )
            );
          } else {
            console.log(
              chalk.green(
                `\n  ✓ Starter template '${res.templateName}' applied successfully!`
              )
            );
            console.log(
              chalk.cyan(
                `    • Collections: ${res.collections.join(', ')}\n` +
                `    • Records: ${res.totalRecords} pre-seeded (${res.totalImages} images created)\n` +
                `    • Duration: ${res.durationMs}ms`
              )
            );
          }
        } catch (err: any) {
          console.error(
            chalk.red(`\n  ✗ Failed to apply starter template '${options.template}': ${err.message}`)
          );
        }

        // When ecommerce template is specified (e.g. npm run demo:backend),
        // ensure the dedicated ecommerce-demo application scope is also idempotently restored/initialized
        if (options.template === 'ecommerce') {
          try {
            await app.apps.ensureDemoAppInitialized(true, { overwrite: Boolean(options.overwrite) });
          } catch (err: any) {
            console.warn(chalk.yellow(`  ℹ Demo application restoration note: ${err.message}`));
          }
        }
      }

      if (options.mockDelay || options.mockFailRate || options.mockError) {
        console.log(
          chalk.magenta(
            `  • Latency & Chaos Simulation active: delay=${options.mockDelay ?? 0}ms, failRate=${options.mockFailRate ?? 0}, error=${options.mockError ?? 500}`
          )
        );
      }

      // Check if superuser exists
      if (!app.auth.hasAdmins()) {
        console.log(
          chalk.yellow(
            '\n  ℹ No superuser found. You can create one via CLI using:\n    npx nodestack superuser create\n    or visit the Web Admin UI on first launch to configure it.'
          )
        );
      }

      await app.start(port, host);
    });


  // Command: superuser create
  const superuserCmd = program.command('superuser').alias('admin').description('Superuser management');

  superuserCmd
    .command('create [email] [password]')
    .description('Create a new superuser/admin account')
    .option('-d, --dir <path>', 'Data directory', './nodestack_data')
    .action(async (emailArg, passArg, options) => {
      const app = new NodeStack({ dataDir: options.dir });

      let email = emailArg;
      let password = passArg;

      if (!email || !password) {
        const rl = readline.createInterface({
          input: process.stdin,
          output: process.stdout,
        });

        const ask = (query: string): Promise<string> =>
          new Promise((resolve) => rl.question(query, resolve));

        if (!email) {
          email = await ask('Admin Email: ');
        }
        if (!password) {
          password = await ask('Admin Password (min 8 chars): ');
        }
        rl.close();
      }

      try {
        const admin = await app.auth.createAdmin(email, password);
        console.log(chalk.green(`\n✓ Superuser '${admin.email}' successfully created!\n`));
      } catch (err: any) {
        console.error(chalk.red(`\n✗ Failed to create superuser: ${err.message}\n`));
        process.exit(1);
      } finally {
        app.close();
      }
    });

  superuserCmd
    .command('reset-password [email] [newPassword]')
    .alias('passwd')
    .description('Reset password for an existing superuser/admin account')
    .option('-d, --dir <path>', 'Data directory', './nodestack_data')
    .action(async (emailArg, passArg, options) => {
      const app = new NodeStack({ dataDir: options.dir });

      let email = emailArg;
      let password = passArg;

      if (!email || !password) {
        const rl = readline.createInterface({
          input: process.stdin,
          output: process.stdout,
        });

        const ask = (query: string): Promise<string> =>
          new Promise((resolve) => rl.question(query, resolve));

        if (!email) {
          email = await ask('Admin Email: ');
        }
        if (!password) {
          password = await ask('New Password (min 8 chars): ');
        }
        rl.close();
      }

      try {
        await app.auth.updateAdminPassword(email, password);
        console.log(chalk.green(`\n✓ Password for superuser '${email}' successfully updated!\n`));
      } catch (err: any) {
        console.error(chalk.red(`\n✗ Failed to update superuser password: ${err.message}\n`));
        process.exit(1);
      } finally {
        app.close();
      }
    });

  // Command: typegen
  program
    .command('typegen')
    .alias('types')
    .description('Generate TypeScript type definitions from SQLite schema')
    .option('-d, --dir <path>', 'The directory where data is stored', './nodestack_data')
    .option('-o, --out <path>', 'Output file path (default: stdout)')
    .action(async (options) => {
      const app = new NodeStack({ dataDir: options.dir });
      try {
        const types = await app.generateTypes();
        if (options.out) {
          const fs = await import('fs');
          const path = await import('path');
          const outPath = path.resolve(process.cwd(), options.out);
          fs.mkdirSync(path.dirname(outPath), { recursive: true });
          fs.writeFileSync(outPath, types, 'utf-8');
          console.error(chalk.green(`✓ TypeScript definitions generated at ${options.out}`));
        } else {
          process.stdout.write(types);
        }
      } catch (err: any) {
        console.error(chalk.red(`✗ Failed to generate types: ${err.message}`));
        process.exit(1);
      } finally {
        app.close();
      }
    });

  // Command: openapi / docs
  program
    .command('openapi')
    .alias('docs')
    .alias('swagger')
    .description('Generate OpenAPI 3.0 specification from SQLite collection schema')
    .option('-d, --dir <path>', 'The directory where data is stored', './nodestack_data')
    .option('-o, --out <path>', 'Output file path (default: stdout)')
    .option('--compact', 'Output compact/minified JSON without indentation', false)
    .action(async (options) => {
      const app = new NodeStack({ dataDir: options.dir });
      try {
        const specJson = await app.generateOpenApiJson(!options.compact);
        if (options.out) {
          const fs = await import('fs');
          const path = await import('path');
          const outPath = path.resolve(process.cwd(), options.out);
          fs.mkdirSync(path.dirname(outPath), { recursive: true });
          fs.writeFileSync(outPath, specJson, 'utf-8');
          console.error(chalk.green(`✓ OpenAPI 3.0 specification generated at ${options.out}`));
        } else {
          process.stdout.write(specJson + '\n');
        }
      } catch (err: any) {
        console.error(chalk.red(`✗ Failed to generate OpenAPI specification: ${err.message}`));
        process.exit(1);
      } finally {
        app.close();
      }
    });

  // Command: mock / seed
  program
    .command('mock <collection> [count]')
    .alias('seed')
    .description('Generate realistic mock data using the built-in Faker engine')
    .option('-d, --dir <path>', 'The directory where data is stored', './nodestack_data')
    .option('--no-files', 'Skip downloading external avatar / placeholder images', false)
    .option('--no-relations', 'Skip auto-seeding empty referenced collections', false)
    .action(async (collection, countArg, options) => {
      const count = parseInt(countArg, 10) || 25;
      const app = new NodeStack({ dataDir: options.dir });
      try {
        const res = await app.mockData.generate(collection, {
          count,
          downloadFiles: options.files !== false,
          autoSeedRelations: options.relations !== false,
        });
        console.log(chalk.green(`✓ Successfully generated ${res.count} mock records for '${collection}'!`));
      } catch (err: any) {
        console.error(chalk.red(`✗ Failed to generate mock data: ${err.message}`));
        process.exit(1);
      } finally {
        app.close();
      }
    });

  // Command: import-json ("Paste JSON → Instant API")
  program
    .command('import-json <collection> <source>')
    .alias('import')
    .description('Import raw JSON object or array to auto-infer schema, create table, and populate records')
    .option('-d, --dir <path>', 'The directory where data is stored', './nodestack_data')
    .action(async (collection, source, options) => {
      const app = new NodeStack({ dataDir: options.dir });
      try {
        let payload: any;
        const fs = await import('fs');
        const path = await import('path');
        const resolvedPath = path.resolve(process.cwd(), source);
        if (fs.existsSync(resolvedPath)) {
          payload = fs.readFileSync(resolvedPath, 'utf-8');
        } else {
          payload = source;
        }

        const res = await app.schemaInference.importJson({
          name: collection,
          data: payload,
        });

        console.log(
          chalk.green(
            `\n✓ Collection '${res.collection.name}' created with ${res.inferredFields.length} inferred fields!\n` +
            `✓ Successfully populated ${res.recordCount} records in ${res.durationMs}ms.\n`
          )
        );
      } catch (err: any) {
        console.error(chalk.red(`\n✗ Failed to import JSON: ${err.message}\n`));
        process.exit(1);
      } finally {
        app.close();
      }
    });

  // Command: template / recipe
  program
    .command('template [name]')
    .alias('recipe')
    .description('Inspect or apply starter templates (ecommerce, blog, crm)')
    .option('-d, --dir <path>', 'The directory where data is stored', './nodestack_data')
    .option('-l, --list', 'List all available starter templates', false)
    .option('--overwrite', 'Overwrite existing collections if they already exist', false)
    .action(async (name, options) => {
      const app = new NodeStack({ dataDir: options.dir });
      try {
        if (options.list || !name) {
          const templates = app.templates.list();
          console.log(chalk.bold.cyan('\n  Available NodeStack Starter Templates:\n'));
          for (const t of templates) {
            console.log(
              `  ${t.icon}  ${chalk.bold.white(t.name)} ${chalk.dim(`(${t.id})`)} — ${chalk.yellow(t.badge)}`
            );
            console.log(`      ${chalk.gray(t.description)}`);
            console.log(
              `      ${chalk.cyan('Collections:')} ${t.collections.join(', ')}  |  ${chalk.cyan('Records:')} ~${t.stats.records} (${t.stats.images} images)\n`
            );
          }
          console.log(
            chalk.dim('  Launch instantly: npx nodestack start --template <name>\n' +
                      '  Or apply offline: npx nodestack template <name>\n')
          );
          return;
        }

        const res = await app.templates.apply(name, {
          overwrite: Boolean(options.overwrite),
        });

        if (res.skipped) {
          console.log(
            chalk.yellow(
              `\nℹ Template '${res.templateName}' is already applied. Use --overwrite to re-create.\n`
            )
          );
        } else {
          console.log(
            chalk.green(`\n✓ Template '${res.templateName}' applied successfully!\n`) +
            chalk.cyan(
              `  • Collections: ${res.collections.join(', ')}\n` +
              `  • Seeded: ${res.totalRecords} records (${res.totalImages} images) in ${res.durationMs}ms\n`
            )
          );
        }
      } catch (err: any) {
        console.error(chalk.red(`\n✗ Error: ${err.message}\n`));
        process.exit(1);
      } finally {
        app.close();
      }
    });

  // Command: collection / collections
  program
    .command('collection [action] [name]')
    .alias('collections')
    .description('Manage database collections (list, delete)')
    .option('-d, --dir <path>', 'The directory where data is stored', './nodestack_data')
    .action(async (actionArg, nameArg, options) => {
      const app = new NodeStack({ dataDir: options.dir });
      try {
        const action = actionArg;
        const name = nameArg;

        if (action === 'delete' || action === 'rm' || action === 'drop') {
          if (!name) {
            console.error(chalk.red('\n✗ Collection name is required: npx nodestack collection delete <name>\n'));
            process.exit(1);
          }
          const col = await app.schema.getCollectionOrThrow(name);
          // Clean storage files before dropping the collection to prevent orphaned files
          try {
            await app.files.deleteCollectionFiles(col.id);
          } catch (fileErr: any) {
            throw new Error(`Failed to delete storage directory for collection '${name}': ${fileErr.message}. Aborting deletion to prevent orphaned data.`);
          }
          await app.schema.deleteCollection(name);
          console.log(chalk.green(`\n✓ Collection '${name}' and its SQLite table were successfully deleted!\n`));
        } else {
          // List collections
          const collections = await app.schema.getAllCollections();
          console.log(chalk.bold.cyan('\n  Database Collections:\n'));
          for (const c of collections) {
            let recordCount = 0;
            try {
              const countRow = await app.db.get<{ count: number }>(`SELECT COUNT(*) as count FROM "${c.name}"`);
              recordCount = countRow ? countRow.count : 0;
            } catch {}
            console.log(
              `  • ${chalk.bold.white(c.name)} ${chalk.dim(`(${c.type})`)} — ${chalk.cyan(`${c.schema.length} fields`)}, ${chalk.yellow(`${recordCount} records`)}`
            );
          }
          console.log(
            chalk.dim('\n  Delete a collection with: npx nodestack collection delete <name>\n')
          );
        }
      } catch (err: any) {
        console.error(chalk.red(`\n✗ Error: ${err.message}\n`));
        process.exit(1);
      } finally {
        app.close();
      }
    });



  // Command: snapshots (list, create, restore, delete, clear)
  program
    .command('snapshots [action] [target]')
    .description('Manage application snapshots, multiple checkpoints, and restore')
    .option('-d, --dir <path>', 'The directory where data is stored', './nodestack_data')
    .option('-n, --name <name>', 'Custom label/name for the snapshot')
    .option('--evict-oldest', 'Automatically evict oldest snapshot if 10-limit is reached')
    .action(async (actionArg, targetArg, options) => {
      const action = actionArg || 'list';
      const app = new NodeStack({ dataDir: options.dir });
      try {
        if (action === 'create' || action === 'take' || action === 'new') {
          const snap = await app.snapshots.createSnapshot({
            name: options.name,
            evictOldest: Boolean(options.evictOldest),
          });
          console.log(chalk.green(`\n✓ Snapshot '${snap.name}' (${snap.id}) successfully created!\n`));
          console.log(chalk.cyan(`  • Records: ${snap.totalRecords}`));
          console.log(chalk.cyan(`  • Collections: ${snap.totalCollections}`));
          console.log(chalk.cyan(`  • Uploaded Files: ${snap.totalFiles} (${snap.storageSizeBytes} bytes)\n`));
        } else if (action === 'restore' || action === 'reset') {
          const res = await app.snapshots.restoreSnapshot(targetArg);
          console.log(chalk.green(`\n✓ Successfully restored snapshot '${res.snapshot.name}' in ${res.durationMs}ms!\n`));
          console.log(chalk.cyan(`  • Restored: ${res.snapshot.totalCollections} collections, ${res.snapshot.totalRecords} records\n`));
        } else if (action === 'delete' || action === 'rm') {
          if (!targetArg) {
            console.error(chalk.red('\n✗ Please provide the snapshot ID to delete: npx nodestack snapshots delete <id>\n'));
            process.exit(1);
          }
          await app.snapshots.deleteSnapshot(targetArg);
          console.log(chalk.yellow(`\n✓ Snapshot '${targetArg}' deleted.\n`));
        } else if (action === 'clear') {
          await app.snapshots.clearAllSnapshots();
          console.log(chalk.yellow(`\n✓ All snapshots cleared.\n`));
        } else {
          const status = await app.snapshots.getStatus();
          if (status.snapshots.length === 0) {
            console.log(chalk.yellow(`\nℹ No snapshots found.`));
            console.log(chalk.dim(`  Create snapshot with: npx nodestack snapshots create\n`));
          } else {
            console.log(chalk.bold.cyan(`\n  📸 Saved Checkpoints (${status.snapshots.length}/${status.maxLimit}):\n`));
            status.snapshots.forEach((s, idx) => {
              const isActive = status.activeSnapshot && s.id === status.activeSnapshot.id;
              const dateStr = new Date(s.createdAt).toLocaleString();
              console.log(
                `  ${idx + 1}. ${chalk.bold.white(s.name)} ${isActive ? chalk.green('[Active]') : ''}`
              );
              console.log(`     ID: ${chalk.gray(s.id)} | Date: ${chalk.gray(dateStr)}`);
              console.log(`     Data: ${chalk.yellow(s.totalRecords)} records, ${chalk.yellow(s.totalCollections)} tables, ${chalk.yellow(s.totalFiles)} files\n`);
            });
          }
        }
      } catch (err: any) {
        console.error(chalk.red(`\n✗ Snapshots error: ${err.message}\n`));
        process.exit(1);
      } finally {
        app.close();
      }
    });

  // Command: db (status, test, switch, configure)
  program
    .command('db [action] [targetProvider] [targetUri]')
    .description('Manage database provider configuration, connection tests, and live migration')
    .option('-d, --dir <path>', 'The directory where data is stored', './nodestack_data')
    .option('-p, --provider <provider>', 'Target database provider (sqlite, postgres, mssql)')
    .option('-c, --connection-string <uri>', 'Connection URI string')
    .option('--host <host>', 'Database server host')
    .option('--port <port>', 'Database server port')
    .option('-u, --user <user>', 'Database username')
    .option('--password <password>', 'Database password')
    .option('--database <database>', 'Database name')
    .option('-m, --migrate', 'Migrate existing schema and data to target database', false)
    .action(async (actionArg, targetProviderArg, targetUriArg, options) => {
      const action = actionArg || 'status';
      const provider = options.provider || targetProviderArg;
      const connectionString = options.connectionString || (targetUriArg && !targetUriArg.startsWith('-') ? targetUriArg : undefined);
      const app = new NodeStack({ dataDir: options.dir });
      try {
        await app.loadActiveDatabaseDriver();
        if (action === 'status') {
          const status = await app.databaseConfig.getStatus(app.db.getRootDriver());
          console.log(chalk.bold.cyan('\n  NodeStack Database Status:\n'));
          console.log(`  • Active Provider:      ${chalk.bold.white(status.provider.toUpperCase())}`);
          console.log(`  • Connected:            ${status.connected ? chalk.green('✓ Yes') : chalk.red('✗ No')}`);
          console.log(`  • Latency:              ${chalk.yellow(`${status.latencyMs}ms`)}`);
          console.log(`  • Available Providers:  ${chalk.dim(status.availableProviders.join(', '))}`);
          console.log(`  • Configuration:        ${chalk.gray(JSON.stringify(status.config, null, 2))}\n`);
        } else if (action === 'test') {
          if (!provider) {
            console.error(chalk.red('\n✗ Target provider is required: db test <sqlite|postgres|mssql> [uri] or --provider <provider>\n'));
            process.exit(1);
          }
          const targetConfig: DatabaseConfig = {
            provider: provider as any,
            connectionString,
            host: options.host,
            port: options.port ? parseInt(options.port, 10) : undefined,
            user: options.user,
            password: options.password,
            database: options.database,
            dataDir: provider === 'sqlite' ? app.config.dataDir : undefined,
            appsDir: provider === 'sqlite' ? app.config.appsDir : undefined,
            dbPath: provider === 'sqlite' ? (connectionString || options.dbPath || app.config.getAppDbPath('default')) : undefined,
          };
          console.log(chalk.cyan(`\nTesting connection to ${targetConfig.provider.toUpperCase()}...`));
          const res = await app.databaseConfig.testConnection(targetConfig);
          if (res.ok) {
            console.log(chalk.green(`\n✓ Connection successful! (${res.latencyMs}ms)`));
            if (res.version) console.log(chalk.dim(`  Server info: ${res.version}\n`));
          } else {
            console.error(chalk.red(`\n✗ Connection failed: ${res.error}\n`));
            process.exit(1);
          }
        } else if (action === 'configure') {
          if (!provider) {
            console.error(chalk.red('\n✗ Target provider is required: db configure <sqlite|postgres|mssql> [uri]\n'));
            process.exit(1);
          }
          const targetConfig: DatabaseConfig = {
            provider: provider as any,
            connectionString,
            host: options.host,
            port: options.port ? parseInt(options.port, 10) : undefined,
            user: options.user,
            password: options.password,
            database: options.database,
            dataDir: provider === 'sqlite' ? app.config.dataDir : undefined,
            appsDir: provider === 'sqlite' ? app.config.appsDir : undefined,
            dbPath: provider === 'sqlite' ? (connectionString || options.dbPath || app.config.getAppDbPath('default')) : undefined,
          };
          const savedId = await app.databaseConfig.saveConfig(targetConfig, false);
          console.log(chalk.green(`\n✓ Database configuration saved (ID: ${savedId})\n`));
        } else if (action === 'switch') {
          if (!provider) {
            console.error(chalk.red('\n✗ Target provider is required: db switch <sqlite|postgres|mssql> [--migrate] or --provider <provider>\n'));
            process.exit(1);
          }
          const targetConfig: DatabaseConfig = {
            provider: provider as any,
            connectionString,
            host: options.host,
            port: options.port ? parseInt(options.port, 10) : undefined,
            user: options.user,
            password: options.password,
            database: options.database,
            dataDir: provider === 'sqlite' ? app.config.dataDir : undefined,
            appsDir: provider === 'sqlite' ? app.config.appsDir : undefined,
            dbPath: provider === 'sqlite' ? (connectionString || options.dbPath || app.config.getAppDbPath('default')) : undefined,
          };

          console.log(chalk.cyan(`\nValidating target database ${targetConfig.provider.toUpperCase()}...`));
          const testRes = await app.databaseConfig.testConnection(targetConfig);
          if (!testRes.ok) {
            console.error(chalk.red(`\n✗ Target database connection test failed: ${testRes.error}\n`));
            process.exit(1);
          }

          if (options.migrate) {
            console.log(chalk.yellow(`Migrating schema and data from current database...`));
            const targetDriver = await DriverRegistry.createDriver(targetConfig);
            const allApps = await app.apps.registry.getAllApps();
            const slugs = allApps.map((a: any) => a.slug);
            const summary = await DatabaseMigrationService.migrateAllApps(
              app.db.getRootDriver(),
              targetDriver,
              slugs
            );
            console.log(chalk.green(`✓ Migration completed in ${summary.elapsedMs}ms:`));
            console.log(`  • Apps: ${summary.appsCount}`);
            console.log(`  • Collections: ${summary.collectionsCount}`);
            console.log(`  • Records: ${summary.recordsCount}`);
            await targetDriver.close();
          }

          await app.databaseConfig.saveConfig(targetConfig, true);
          console.log(chalk.green(`\n✓ Active database switched successfully to ${targetConfig.provider.toUpperCase()}!\n`));
        } else {
          console.error(chalk.red(`\n✗ Unknown db action: '${action}'. Expected: status, test, switch, configure\n`));
          process.exit(1);
        }
      } catch (err: any) {
        console.error(chalk.red(`\n✗ Database error: ${err.message}\n`));
        process.exit(1);
      } finally {
        app.close();
      }
    });

  return await program.parseAsync(argv);
}


if (require.main === module) {
  runCli();
}
