import { Command } from 'commander';
import chalk from 'chalk';
import * as readline from 'readline';
import { NodeStack } from '../NodeStack';

export async function runCli(argv = process.argv): Promise<Command> {
  const program = new Command();

  program
    .name('nodestack')
    .description('NodeStack — The TypeScript-Native Embedded Backend Stack')
    .version('1.0.0');

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
      let host = '0.0.0.0';
      let port = 8090;

      if (options.http.includes(':')) {
        const parts = options.http.split(':');
        host = parts[0] || '0.0.0.0';
        port = parseInt(parts[1], 10) || 8090;
      } else if (!isNaN(Number(options.http))) {
        port = Number(options.http);
      }

      const app = new NodeStack({
        dataDir: options.dir,
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
      }

      if (options.mockDelay || options.mockFailRate || options.mockError) {
        console.log(
          chalk.magenta(
            `  ⚡ Latency & Chaos Simulation active: delay=${options.mockDelay ?? 0}ms, failRate=${options.mockFailRate ?? 0}, error=${options.mockError ?? 500}`
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
        app.db.close();
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
        const types = app.generateTypes();
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
        app.db.close();
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
        const specJson = app.generateOpenApiJson(!options.compact);
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
        app.db.close();
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
        app.db.close();
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
        app.db.close();
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
        app.db.close();
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
          const col = app.schema.getCollectionOrThrow(name);
          // Clean storage files before dropping the collection to prevent orphaned files
          try {
            await app.files.deleteCollectionFiles(col.id);
          } catch (fileErr: any) {
            throw new Error(`Failed to delete storage directory for collection '${name}': ${fileErr.message}. Aborting deletion to prevent orphaned data.`);
          }
          app.schema.deleteCollection(name);
          console.log(chalk.green(`\n✓ Collection '${name}' and its SQLite table were successfully deleted!\n`));
        } else {
          // List collections
          const collections = app.schema.getAllCollections();
          console.log(chalk.bold.cyan('\n  Database Collections:\n'));
          for (const c of collections) {
            let recordCount = 0;
            try {
              const countRow = app.db.get<{ count: number }>(`SELECT COUNT(*) as count FROM "${c.name}"`);
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
        app.db.close();
      }
    });

  // Command: demo (snapshot, reset, status, clear)
  program
    .command('demo [action]')
    .alias('snapshot')
    .description('Manage demo snapshots and 1-click restore ("Reset to Demo State")')
    .option('-d, --dir <path>', 'The directory where data is stored', './nodestack_data')
    .option('-n, --name <name>', 'Custom label/name for the demo snapshot')
    .action(async (actionArg, options) => {
      const action = actionArg || 'status';
      const app = new NodeStack({ dataDir: options.dir });
      try {
        if (action === 'snapshot' || action === 'freeze' || action === 'save') {
          const snap = await app.demo.snapshot({ name: options.name });
          console.log(chalk.green(`\n✓ Demo baseline state successfully frozen!\n`));
          console.log(chalk.cyan(`  • Name: ${snap.name}`));
          console.log(chalk.cyan(`  • Collections: ${snap.totalCollections}`));
          console.log(chalk.cyan(`  • Records: ${snap.totalRecords}`));
          console.log(chalk.cyan(`  • Uploaded Files: ${snap.totalFiles} (${snap.storageSizeBytes} bytes)\n`));
          console.log(chalk.dim(`  Ready for presentations! Restore anytime with: npx nodestack demo reset\n`));
        } else if (action === 'reset' || action === 'restore') {
          const res = await app.demo.reset();
          console.log(chalk.green(`\n✓ Successfully restored clean demo state in ${res.durationMs}ms!\n`));
          console.log(chalk.cyan(`  • Baseline: '${res.snapshot.name}'`));
          console.log(chalk.cyan(`  • Restored: ${res.snapshot.totalCollections} collections, ${res.snapshot.totalRecords} records\n`));
        } else if (action === 'clear' || action === 'delete' || action === 'rm') {
          await app.demo.clearSnapshot();
          console.log(chalk.yellow(`\n✓ Demo snapshot cleared.\n`));
        } else {
          // Status
          const status = app.demo.getStatus();
          if (!status.hasSnapshot) {
            console.log(chalk.yellow(`\nℹ No demo snapshot found.`));
            console.log(chalk.dim(`  Freeze clean baseline with: npx nodestack demo snapshot\n`));
          } else {
            console.log(chalk.bold.cyan(`\n  📸 Active Demo Snapshot:`));
            console.log(`  • Name: ${chalk.bold.white(status.snapshot!.name)}`);
            console.log(`  • Created: ${chalk.gray(new Date(status.snapshot!.createdAt).toLocaleString())}`);
            console.log(
              `  • Baseline: ${chalk.yellow(status.snapshot!.totalCollections)} collections, ${chalk.yellow(
                status.snapshot!.totalRecords
              )} records, ${chalk.yellow(status.snapshot!.totalFiles)} files`
            );
            if (status.liveStats) {
              const { drift } = status.liveStats;
              if (drift.isModified) {
                const recDiff = drift.recordsDelta >= 0 ? `+${drift.recordsDelta}` : `${drift.recordsDelta}`;
                const colDiff = drift.collectionsDelta >= 0 ? `+${drift.collectionsDelta}` : `${drift.collectionsDelta}`;
                const details = (drift.recordsDelta !== 0 || drift.collectionsDelta !== 0)
                  ? `${recDiff} records, ${colDiff} collections since snapshot`
                  : `record or schema content modified since snapshot`;
                console.log(chalk.magenta(`  • Live drift detected: ${details}`));
                console.log(chalk.green(`  ➜ Click "Reset Demo Data" in Admin UI or run: npx nodestack demo reset\n`));
              } else {
                console.log(chalk.green(`  • Status: Live data is pristine and matches demo baseline!\n`));
              }
            }
          }
        }
      } catch (err: any) {
        console.error(chalk.red(`\n✗ Demo error: ${err.message}\n`));
        process.exit(1);
      } finally {
        app.db.close();
      }
    });


  return await program.parseAsync(argv);
}


if (require.main === module) {
  runCli();
}
