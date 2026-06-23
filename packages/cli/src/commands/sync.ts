import { Command } from 'commander';
import chalk from 'chalk';
import ora from 'ora';
import { resolve } from 'node:path';

export const syncCommand = new Command('sync')
  .description('Manage sync with relay server');

// --- sync status ---
syncCommand
  .command('status')
  .description('Show sync status: pending ops, last sync time, connection state')
  .action(async () => {
    const spinner = ora('Checking sync status...').start();

    try {
      const dbPath = process.env.DB_PATH || resolve('./data/shared-brain.db');
      const relayUrl = process.env.SYNC_RELAY_URL;

      const { SqliteStore } = await import('@shared-brain/core');
      const store = new SqliteStore(dbPath);
      await store.initialize();

      // Get pending operations count
      const pendingOps = await store.getPendingOpsCount();
      const lastSyncTime = await store.getSyncState('last_sync_time');
      const lastSyncHash = await store.getSyncState('last_sync_hash');

      await store.close();
      spinner.stop();

      console.log('');
      console.log(chalk.bold('  Sync Status'));
      console.log(chalk.dim('  ' + '-'.repeat(40)));
      console.log('');

      // Connection state
      if (relayUrl) {
        console.log(chalk.dim('  Relay URL:    '), chalk.cyan(relayUrl));
        console.log(chalk.dim('  Connection:   '), chalk.yellow('disconnected (CLI is offline)'));
      } else {
        console.log(chalk.dim('  Relay URL:    '), chalk.dim('not configured'));
        console.log(chalk.dim('  Connection:   '), chalk.dim('local-only mode'));
      }

      console.log('');

      // Pending operations
      if (pendingOps > 0) {
        console.log(chalk.dim('  Pending ops:  '), chalk.yellow(`${pendingOps} operations waiting to sync`));
      } else {
        console.log(chalk.dim('  Pending ops:  '), chalk.green('0 (all synced)'));
      }

      // Last sync time
      if (lastSyncTime) {
        const ago = formatTimeAgo(new Date(lastSyncTime));
        console.log(chalk.dim('  Last sync:    '), `${lastSyncTime} (${ago})`);
      } else {
        console.log(chalk.dim('  Last sync:    '), chalk.dim('never'));
      }

      // Merkle hash
      if (lastSyncHash) {
        console.log(chalk.dim('  Merkle hash:  '), chalk.dim(lastSyncHash.substring(0, 16) + '...'));
      }

      console.log('');
    } catch (error) {
      spinner.fail(chalk.red('Failed to get sync status'));
      console.error(chalk.red(`  ${(error as Error).message}`));
      process.exit(1);
    }
  });

// --- sync push ---
syncCommand
  .command('push')
  .description('Force push pending operations to relay server')
  .action(async () => {
    const spinner = ora('Pushing to relay...').start();

    try {
      const relayUrl = process.env.SYNC_RELAY_URL;
      const syncToken = process.env.SYNC_AUTH_TOKEN;

      if (!relayUrl) {
        spinner.fail(chalk.red('No relay URL configured'));
        console.log(chalk.dim('  Set SYNC_RELAY_URL in your .env file'));
        process.exit(1);
      }

      const dbPath = process.env.DB_PATH || resolve('./data/shared-brain.db');
      const { SqliteStore } = await import('@shared-brain/core');
      const { SyncClient } = await import('@shared-brain/sync');

      const store = new SqliteStore(dbPath);
      await store.initialize();

      spinner.text = 'Connecting to relay...';
      const client = new SyncClient({
        url: relayUrl,
        token: syncToken,
        store,
      });

      await client.connect();

      spinner.text = 'Pushing operations...';
      const pushed = await client.pushPending();

      await client.disconnect();
      await store.close();

      spinner.succeed(chalk.green(`Pushed ${pushed} operation${pushed !== 1 ? 's' : ''} to relay`));
      console.log('');
    } catch (error) {
      spinner.fail(chalk.red('Push failed'));
      console.error(chalk.red(`  ${(error as Error).message}`));
      process.exit(1);
    }
  });

// --- sync pull ---
syncCommand
  .command('pull')
  .description('Force pull from relay server')
  .action(async () => {
    const spinner = ora('Pulling from relay...').start();

    try {
      const relayUrl = process.env.SYNC_RELAY_URL;
      const syncToken = process.env.SYNC_AUTH_TOKEN;

      if (!relayUrl) {
        spinner.fail(chalk.red('No relay URL configured'));
        console.log(chalk.dim('  Set SYNC_RELAY_URL in your .env file'));
        process.exit(1);
      }

      const dbPath = process.env.DB_PATH || resolve('./data/shared-brain.db');
      const { SqliteStore } = await import('@shared-brain/core');
      const { SyncClient } = await import('@shared-brain/sync');

      const store = new SqliteStore(dbPath);
      await store.initialize();

      spinner.text = 'Connecting to relay...';
      const client = new SyncClient({
        url: relayUrl,
        token: syncToken,
        store,
      });

      await client.connect();

      spinner.text = 'Pulling operations...';
      const pulled = await client.pullRemote();

      await client.disconnect();
      await store.close();

      spinner.succeed(chalk.green(`Pulled ${pulled} operation${pulled !== 1 ? 's' : ''} from relay`));
      console.log('');
    } catch (error) {
      spinner.fail(chalk.red('Pull failed'));
      console.error(chalk.red(`  ${(error as Error).message}`));
      process.exit(1);
    }
  });

function formatTimeAgo(date: Date): string {
  const seconds = Math.floor((Date.now() - date.getTime()) / 1000);
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}
