#!/usr/bin/env node
import { Command } from 'commander';
import chalk from 'chalk';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

import { initCommand } from './commands/init.js';
import { storeCommand } from './commands/store.js';
import { searchCommand } from './commands/search.js';
import { syncCommand } from './commands/sync.js';

// Load version from package.json
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const pkg = JSON.parse(readFileSync(resolve(__dirname, '../package.json'), 'utf-8'));

// Banner
const banner = `
${chalk.bold.hex('#7C3AED')('  ╔══════════════════════════════════════╗')}
${chalk.bold.hex('#7C3AED')('  ║')}  ${chalk.bold('SharedBrain')} ${chalk.dim('— MCP-native shared memory')} ${chalk.bold.hex('#7C3AED')('║')}
${chalk.bold.hex('#7C3AED')('  ╚══════════════════════════════════════╝')}
`;

const program = new Command();

program
  .name('shared-brain')
  .description('Local-first, multi-user shared memory with semantic search')
  .version(pkg.version, '-v, --version')
  .addHelpText('before', banner)
  .hook('preAction', () => {
    // Load .env if present
    try {
      const envPath = resolve(process.cwd(), '.env');
      const envContent = readFileSync(envPath, 'utf-8');
      for (const line of envContent.split('\n')) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith('#')) continue;
        const eqIdx = trimmed.indexOf('=');
        if (eqIdx === -1) continue;
        const key = trimmed.substring(0, eqIdx).trim();
        const value = trimmed.substring(eqIdx + 1).trim();
        if (!process.env[key]) {
          process.env[key] = value;
        }
      }
    } catch {
      // No .env file — that's fine
    }
  });

// Register commands
program.addCommand(initCommand);
program.addCommand(storeCommand);
program.addCommand(searchCommand);
program.addCommand(syncCommand);

// Parse and execute
program.parse();
