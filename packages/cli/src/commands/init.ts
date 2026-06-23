#!/usr/bin/env node
import { Command } from 'commander';
import chalk from 'chalk';
import ora from 'ora';
import { randomBytes } from 'node:crypto';
import { mkdirSync, writeFileSync, existsSync } from 'node:fs';
import { resolve, join } from 'node:path';

export const initCommand = new Command('init')
  .description('Initialize a new SharedBrain instance')
  .option('-d, --dir <path>', 'Data directory path', './data')
  .option('--force', 'Overwrite existing configuration', false)
  .action(async (opts) => {
    const spinner = ora('Initializing SharedBrain...').start();

    try {
      const dataDir = resolve(opts.dir);
      const envPath = resolve('.env');
      const dbPath = join(dataDir, 'shared-brain.db');

      // Step 1: Create data directory
      spinner.text = 'Creating data directory...';
      if (!existsSync(dataDir)) {
        mkdirSync(dataDir, { recursive: true });
      }

      // Step 2: Initialize SQLite database with migrations
      spinner.text = 'Initializing database...';
      const { SqliteStore } = await import('@shared-brain/core');
      const store = new SqliteStore(dbPath);
      await store.initialize();
      await store.close();

      // Step 3: Generate auth token
      const authToken = randomBytes(32).toString('hex');

      // Step 4: Write .env file
      spinner.text = 'Writing configuration...';
      if (existsSync(envPath) && !opts.force) {
        spinner.warn(chalk.yellow('.env file already exists. Use --force to overwrite.'));
      } else {
        const envContent = `# SharedBrain Configuration
# Generated on ${new Date().toISOString()}

# Server
PORT=3100
HOST=127.0.0.1

# Database
DB_PATH=${dbPath}

# Auth token (keep this secret!)
AUTH_TOKEN=${authToken}

# Sync relay (optional - uncomment to enable team sync)
# SYNC_RELAY_URL=ws://localhost:3200
# SYNC_AUTH_TOKEN=your-sync-token

# Embeddings
MODELS_PATH=./models
EMBEDDING_MODEL=Xenova/all-MiniLM-L6-v2
`;
        writeFileSync(envPath, envContent, 'utf-8');
      }

      spinner.succeed(chalk.green('SharedBrain initialized successfully!'));

      // Print setup instructions
      console.log('');
      console.log(chalk.bold('  Next steps:'));
      console.log('');
      console.log(chalk.dim('  1.') + ' Start the MCP server:');
      console.log(chalk.cyan('     pnpm --filter @shared-brain/server dev'));
      console.log('');
      console.log(chalk.dim('  2.') + ' Add to your MCP client config:');
      console.log('');
      console.log(chalk.gray('     {'));
      console.log(chalk.gray('       "mcpServers": {'));
      console.log(chalk.gray('         "shared-brain": {'));
      console.log(chalk.gray('           "type": "streamable-http",'));
      console.log(chalk.gray(`           "url": "http://127.0.0.1:3100/mcp",`));
      console.log(chalk.gray('           "headers": {'));
      console.log(chalk.gray(`             "Authorization": "Bearer ${authToken}"`));
      console.log(chalk.gray('           }'));
      console.log(chalk.gray('         }'));
      console.log(chalk.gray('       }'));
      console.log(chalk.gray('     }'));
      console.log('');
      console.log(chalk.dim('  3.') + ' Store your first memory:');
      console.log(chalk.cyan('     shared-brain store --content "Hello world" --type fact'));
      console.log('');
      console.log(chalk.dim('  Auth token:'), chalk.yellow(authToken));
      console.log(chalk.dim('  Database:'), chalk.dim(dbPath));
      console.log('');
    } catch (error) {
      spinner.fail(chalk.red('Initialization failed'));
      console.error(chalk.red(`  ${(error as Error).message}`));
      process.exit(1);
    }
  });
