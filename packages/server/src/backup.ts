import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync, statSync, unlinkSync } from 'fs';
import { join, dirname, basename } from 'path';

export interface BackupConfig {
  s3Bucket?: string;
  s3Region?: string;
  localRetentionDays?: number;
  intervalHours?: number;
}

export interface BackupResult {
  success: boolean;
  localPath?: string;
  s3Path?: string;
  size: number;
  timestamp: string;
  error?: string;
}

export interface BackupInfo {
  filename: string;
  date: string;
  size: number;
  path: string;
}

export class BackupManager {
  private dbPath: string;
  private config: BackupConfig;
  private backupDir: string;
  private intervalHandle: NodeJS.Timeout | null = null;
  private lastBackupTime: string | null = null;
  private backupCount: number = 0;
  private totalSize: number = 0;
  private s3Client: any = null;

  constructor(dbPath: string, config: BackupConfig = {}) {
    this.dbPath = dbPath;
    this.config = {
      localRetentionDays: config.localRetentionDays ?? 7,
      intervalHours: config.intervalHours ?? 24,
      s3Bucket: config.s3Bucket ?? process.env['S3_BACKUP_BUCKET'],
      s3Region: config.s3Region ?? process.env['AWS_REGION'] ?? 'us-west-2',
    };
    this.backupDir = join(dirname(dbPath), 'backups');
  }

  async initialize(): Promise<void> {
    // Ensure backup directory exists
    if (!existsSync(this.backupDir)) {
      mkdirSync(this.backupDir, { recursive: true });
      console.log(`[backup] Created backup directory: ${this.backupDir}`);
    }

    // Initialize S3 client if configured
    if (this.config.s3Bucket && this.config.s3Region) {
      try {
        const s3Mod = await import(/* @vite-ignore */ '@aws-sdk/client-s3' as any);
        const { S3Client } = s3Mod;
        this.s3Client = new S3Client({ region: this.config.s3Region });
        console.log(`[backup] S3 backup configured: ${this.config.s3Bucket} (${this.config.s3Region})`);
      } catch (err) {
        console.warn('[backup] S3 client unavailable (optional dependency not installed)');
      }
    }

    // Scan existing backups
    this.scanBackups();

    // Run initial backup if last backup is > 24h ago or no backups exist
    const shouldBackup = !this.lastBackupTime || this.isBackupStale();
    if (shouldBackup) {
      console.log('[backup] Running initial backup...');
      await this.backup();
    }

    // Start interval timer
    const intervalMs = this.config.intervalHours! * 60 * 60 * 1000;
    this.intervalHandle = setInterval(() => this.backup(), intervalMs);
    console.log(`[backup] Auto-backup scheduled every ${this.config.intervalHours}h`);
  }

  async backup(): Promise<BackupResult> {
    const timestamp = new Date().toISOString();
    const dateStr = timestamp.split('T')[0];
    const filename = `brain-${dateStr}.db`;
    const localPath = join(this.backupDir, filename);

    try {
      // Copy database file
      if (!existsSync(this.dbPath)) {
        throw new Error(`Database file not found: ${this.dbPath}`);
      }

      const dbData = readFileSync(this.dbPath);
      writeFileSync(localPath, dbData);
      const size = statSync(localPath).size;

      console.log(`[backup] Local backup created: ${filename} (${this.formatSize(size)})`);

      this.lastBackupTime = timestamp;
      this.scanBackups();

      // Clean up old backups (keep last N days)
      this.cleanOldBackups();

      const result: BackupResult = {
        success: true,
        localPath,
        size,
        timestamp,
      };

      // Upload to S3 if configured
      if (this.s3Client && this.config.s3Bucket) {
        try {
          const s3Path = await this.uploadToS3(localPath, filename);
          result.s3Path = s3Path;
          console.log(`[backup] S3 upload complete: ${s3Path}`);
        } catch (err: any) {
          console.warn(`[backup] S3 upload failed: ${err.message}`);
          // Don't fail the backup — local backup succeeded
        }
      }

      return result;
    } catch (err: any) {
      console.error(`[backup] Backup failed: ${err.message}`);
      return {
        success: false,
        size: 0,
        timestamp,
        error: err.message,
      };
    }
  }

  private async uploadToS3(localPath: string, filename: string): Promise<string> {
    if (!this.s3Client) throw new Error('S3 client not initialized');

    try {
      const s3Mod2 = await import(/* @vite-ignore */ '@aws-sdk/client-s3' as any);
      const { PutObjectCommand } = s3Mod2;
      const body = readFileSync(localPath);
      const key = `shared-brain/backups/${filename}`;

      await this.s3Client.send(
        new PutObjectCommand({
          Bucket: this.config.s3Bucket!,
          Key: key,
          Body: body,
          ContentType: 'application/x-sqlite3',
        })
      );

      return `s3://${this.config.s3Bucket}/${key}`;
    } catch (err: any) {
      throw new Error(`S3 upload failed: ${err.message}`);
    }
  }

  async listBackups(): Promise<BackupInfo[]> {
    if (!existsSync(this.backupDir)) return [];

    const files = readdirSync(this.backupDir)
      .filter(f => f.startsWith('brain-') && f.endsWith('.db'))
      .map(filename => {
        const path = join(this.backupDir, filename);
        const stats = statSync(path);
        const dateMatch = filename.match(/brain-(\d{4}-\d{2}-\d{2})\.db/);
        return {
          filename,
          date: dateMatch ? dateMatch[1] : 'unknown',
          size: stats.size,
          path,
        };
      })
      .sort((a, b) => b.date.localeCompare(a.date));

    return files;
  }

  getStatus(): {
    lastBackup: string | null;
    nextBackup: string;
    backupCount: number;
    totalSize: string;
    s3Enabled: boolean;
  } {
    const next = this.lastBackupTime
      ? new Date(new Date(this.lastBackupTime).getTime() + this.config.intervalHours! * 60 * 60 * 1000).toISOString()
      : 'pending';

    return {
      lastBackup: this.lastBackupTime,
      nextBackup: next,
      backupCount: this.backupCount,
      totalSize: this.formatSize(this.totalSize),
      s3Enabled: !!(this.s3Client && this.config.s3Bucket),
    };
  }

  private scanBackups(): void {
    const backups = readdirSync(this.backupDir)
      .filter(f => f.startsWith('brain-') && f.endsWith('.db'))
      .map(f => {
        const path = join(this.backupDir, f);
        const stats = statSync(path);
        return { filename: f, mtime: stats.mtime, size: stats.size };
      })
      .sort((a, b) => b.mtime.getTime() - a.mtime.getTime());

    this.backupCount = backups.length;
    this.totalSize = backups.reduce((sum, b) => sum + b.size, 0);

    if (backups.length > 0) {
      this.lastBackupTime = backups[0].mtime.toISOString();
    }
  }

  private cleanOldBackups(): void {
    const backups = readdirSync(this.backupDir)
      .filter(f => f.startsWith('brain-') && f.endsWith('.db'))
      .map(f => {
        const path = join(this.backupDir, f);
        const stats = statSync(path);
        return { filename: f, mtime: stats.mtime, path };
      })
      .sort((a, b) => b.mtime.getTime() - a.mtime.getTime());

    // Keep last N backups based on retention days
    const retentionCount = this.config.localRetentionDays!;
    const toDelete = backups.slice(retentionCount);

    for (const backup of toDelete) {
      try {
        unlinkSync(backup.path);
        console.log(`[backup] Deleted old backup: ${backup.filename}`);
      } catch (err: any) {
        console.warn(`[backup] Failed to delete ${backup.filename}: ${err.message}`);
      }
    }
  }

  private isBackupStale(): boolean {
    if (!this.lastBackupTime) return true;
    const ageMs = Date.now() - new Date(this.lastBackupTime).getTime();
    const staleMs = this.config.intervalHours! * 60 * 60 * 1000;
    return ageMs > staleMs;
  }

  private formatSize(bytes: number): string {
    if (bytes < 1024) return `${bytes}B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`;
    if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
    return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)}GB`;
  }

  shutdown(): void {
    if (this.intervalHandle) {
      clearInterval(this.intervalHandle);
      this.intervalHandle = null;
      console.log('[backup] Backup scheduler stopped');
    }
  }
}
