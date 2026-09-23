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
      });

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

  return await program.parseAsync(argv);
}

if (require.main === module) {
  runCli();
}
