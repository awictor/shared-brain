import { Command } from 'commander';
import chalk from 'chalk';
import ora from 'ora';
import { resolve } from 'node:path';
import { randomUUID } from 'node:crypto';

export const storeCommand = new Command('store')
  .description('Store a new memory')
  .option('-c, --content <text>', 'Memory content')
  .option('-t, --type <type>', 'Memory type (fact|procedure|decision|context|preference|reference)', 'fact')
  .option('-s, --scope <scope>', 'Visibility scope (personal|team|org)', 'personal')
  .option('--tags <tags>', 'Comma-separated tags')
  .option('--title <title>', 'Optional title/summary')
  .action(async (opts) => {
    if (!opts.content) {
      console.error(chalk.red('Error: --content is required'));
      console.log(chalk.dim('  Usage: shared-brain store --content "Your memory" --type fact'));
      process.exit(1);
    }

    const validTypes = ['fact', 'procedure', 'decision', 'context', 'preference', 'reference'];
    if (!validTypes.includes(opts.type)) {
      console.error(chalk.red(`Error: Invalid type "${opts.type}". Must be one of: ${validTypes.join(', ')}`));
      process.exit(1);
    }

    const validScopes = ['personal', 'team', 'org'];
    if (!validScopes.includes(opts.scope)) {
      console.error(chalk.red(`Error: Invalid scope "${opts.scope}". Must be one of: ${validScopes.join(', ')}`));
      process.exit(1);
    }

    const spinner = ora('Storing memory...').start();

    try {
      // Resolve DB path from env or default
      const dbPath = process.env.DB_PATH || resolve('./data/shared-brain.db');

      // Import core modules
      const { SqliteStore, EmbeddingEngine } = await import('@shared-brain/core');

      // Connect to SQLite
      spinner.text = 'Connecting to database...';
      const store = new SqliteStore(dbPath);
      await store.initialize();

      // Compute embedding
      spinner.text = 'Computing embedding...';
      const engine = new EmbeddingEngine();
      await engine.initialize();
      const embedding = await engine.embed(opts.content);

      // Parse tags
      const tags: string[] = opts.tags
        ? opts.tags.split(',').map((t: string) => t.trim()).filter(Boolean)
        : [];

      // Create memory record
      const memoryId = randomUUID();
      const now = new Date().toISOString();

      const memory = {
        id: memoryId,
        content: opts.content,
        title: opts.title || null,
        type: opts.type,
        scope: opts.scope,
        teamId: null,
        orgId: null,
        authorId: 'cli-user',
        authorName: 'CLI User',
        tags,
        embedding,
        hlc: `${Date.now()}:0000:cli`,
        deleted: false,
        createdAt: now,
        updatedAt: now,
        source: { type: 'cli', agent: 'shared-brain-cli', reference: null },
        relations: [],
        version: 1,
      };

      // Store in database
      spinner.text = 'Writing to database...';
      await store.create(memory);
      await store.close();

      spinner.succeed(chalk.green('Memory stored successfully'));
      console.log('');
      console.log(chalk.dim('  ID:'), chalk.cyan(memoryId));
      console.log(chalk.dim('  Type:'), opts.type);
      console.log(chalk.dim('  Scope:'), opts.scope);
      if (opts.title) {
        console.log(chalk.dim('  Title:'), opts.title);
      }
      if (tags.length > 0) {
        console.log(chalk.dim('  Tags:'), tags.map(t => chalk.magenta(`#${t}`)).join(' '));
      }
      console.log(chalk.dim('  Content:'), opts.content.length > 80
        ? opts.content.substring(0, 77) + '...'
        : opts.content);
      console.log('');
    } catch (error) {
      spinner.fail(chalk.red('Failed to store memory'));
      console.error(chalk.red(`  ${(error as Error).message}`));
      process.exit(1);
    }
  });
