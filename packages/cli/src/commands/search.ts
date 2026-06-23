import { Command } from 'commander';
import chalk from 'chalk';
import ora from 'ora';
import { resolve } from 'node:path';

export const searchCommand = new Command('search')
  .description('Semantic search across memories')
  .argument('<query>', 'Natural language search query')
  .option('-l, --limit <number>', 'Maximum results to return', '10')
  .option('--threshold <number>', 'Minimum similarity score (0-1)', '0.3')
  .option('-s, --scope <scope>', 'Filter by scope (personal|team|org)')
  .option('-t, --type <type>', 'Filter by memory type')
  .option('--tags <tags>', 'Filter by tags (comma-separated)')
  .action(async (query: string, opts) => {
    const spinner = ora('Searching memories...').start();

    try {
      const dbPath = process.env.DB_PATH || resolve('./data/shared-brain.db');
      const limit = parseInt(opts.limit, 10);
      const threshold = parseFloat(opts.threshold);

      // Import core modules
      const { SqliteStore, EmbeddingEngine, VectorIndex, cosineSimilarity } = await import('@shared-brain/core');

      // Connect and initialize
      spinner.text = 'Connecting to database...';
      const store = new SqliteStore(dbPath);
      await store.initialize();

      spinner.text = 'Loading embedding engine...';
      const engine = new EmbeddingEngine();
      await engine.initialize();

      // Compute query embedding
      spinner.text = 'Computing query embedding...';
      const queryEmbedding = await engine.embed(query);

      // Load all memory vectors and build index
      spinner.text = 'Searching vector index...';
      const allVectors = await store.getAllVectors();

      const index = new VectorIndex();
      for (const { id, embedding } of allVectors) {
        index.add(id, embedding);
      }

      // Perform search
      let results = index.search(queryEmbedding, limit * 2, threshold);

      // Fetch full memory records for results
      const memories = await store.getMany(results.map(r => r.id));

      // Apply filters
      let filtered = memories.map((mem, i) => ({
        memory: mem,
        score: results.find(r => r.id === mem.id)?.score || 0,
      }));

      if (opts.scope) {
        filtered = filtered.filter(r => r.memory.scope === opts.scope);
      }
      if (opts.type) {
        filtered = filtered.filter(r => r.memory.type === opts.type);
      }
      if (opts.tags) {
        const filterTags = opts.tags.split(',').map((t: string) => t.trim());
        filtered = filtered.filter(r =>
          filterTags.some((tag: string) => r.memory.tags.includes(tag))
        );
      }

      // Limit results
      filtered = filtered.slice(0, limit);

      await store.close();
      spinner.stop();

      // Display results
      if (filtered.length === 0) {
        console.log(chalk.yellow('\n  No memories found matching your query.\n'));
        return;
      }

      console.log('');
      console.log(chalk.bold(`  Found ${filtered.length} result${filtered.length !== 1 ? 's' : ''} for: "${query}"`));
      console.log('');

      // Table header
      const idWidth = 8;
      const scoreWidth = 7;
      const typeWidth = 12;
      const titleWidth = 30;
      const snippetWidth = 40;

      console.log(
        chalk.dim('  ') +
        chalk.bold(pad('ID', idWidth)) +
        chalk.bold(pad('Score', scoreWidth)) +
        chalk.bold(pad('Type', typeWidth)) +
        chalk.bold(pad('Title', titleWidth)) +
        chalk.bold('Snippet')
      );
      console.log(chalk.dim('  ' + '-'.repeat(idWidth + scoreWidth + typeWidth + titleWidth + snippetWidth)));

      for (const { memory, score } of filtered) {
        const shortId = memory.id.substring(0, 8);
        const scoreStr = (score * 100).toFixed(1) + '%';
        const title = truncate(memory.title || '(untitled)', titleWidth - 2);
        const snippet = truncate(memory.content.replace(/\n/g, ' '), snippetWidth - 2);

        const scoreColor = score >= 0.7 ? chalk.green : score >= 0.5 ? chalk.yellow : chalk.dim;

        console.log(
          '  ' +
          chalk.cyan(pad(shortId, idWidth)) +
          scoreColor(pad(scoreStr, scoreWidth)) +
          chalk.magenta(pad(memory.type, typeWidth)) +
          pad(title, titleWidth) +
          chalk.dim(snippet)
        );
      }

      console.log('');

      // Show tags summary if any
      const allTags = new Set(filtered.flatMap(r => r.memory.tags));
      if (allTags.size > 0) {
        console.log(chalk.dim('  Tags:'), [...allTags].map(t => chalk.magenta(`#${t}`)).join(' '));
        console.log('');
      }
    } catch (error) {
      spinner.fail(chalk.red('Search failed'));
      console.error(chalk.red(`  ${(error as Error).message}`));
      process.exit(1);
    }
  });

function pad(str: string, width: number): string {
  return str.length >= width ? str.substring(0, width) : str + ' '.repeat(width - str.length);
}

function truncate(str: string, maxLen: number): string {
  if (str.length <= maxLen) return str;
  return str.substring(0, maxLen - 3) + '...';
}
