/**
 * JWT Authentication Layer for SharedBrain
 *
 * Replaces trust-based X-User-Id headers with proper JWT token signing and validation.
 *
 * Architecture:
 * - On first run: generates HMAC secret (32 random bytes) stored encrypted in sync_state table
 * - GET /api/auth/token?userId=alice&userName=Alice → issues signed JWT (30-day exp)
 * - Middleware on /mcp: validates Authorization: Bearer <jwt>, extracts userId/userName
 * - Token revocation: GET /api/auth/revoke?token=X → adds to revoked_tokens table
 * - Localhost fallback: if no JWT and running on 127.0.0.1, falls back to X-User-Id header
 * - Non-localhost: if no JWT, returns 401 Unauthorized
 */

import jwt from 'jsonwebtoken';
import { randomBytes, createCipheriv, createDecipheriv, pbkdf2Sync } from 'node:crypto';
import type { Request, Response, NextFunction, RequestHandler } from 'express';

export interface JWTPayload {
  userId: string;
  userName: string;
  jti: string; // JWT ID for revocation
  iat: number;
  exp: number;
}

export class JWTAuth {
  private secret: string | null = null;
  private revokedTokens: Set<string> = new Set();
  private masterKey: Buffer | null = null;

  constructor(private db: any) {
    // Initialize master key from environment or derive from DB path
    const masterKeyEnv = process.env['MASTER_KEY'];
    if (masterKeyEnv) {
      // Use provided master key (32 bytes hex)
      this.masterKey = Buffer.from(masterKeyEnv, 'hex');
      if (this.masterKey.length !== 32) {
        throw new Error('MASTER_KEY must be 32 bytes (64 hex chars)');
      }
      console.log('[jwt-auth] Using MASTER_KEY from environment for secret encryption.');
    } else {
      // Dev mode: derive key from DB path as salt (fallback)
      const dbPath = process.env['DB_PATH'] ?? 'C:/Users/awictor/shared-brain/data/brain.db';
      const passphrase = 'shared-brain-dev-passphrase'; // Static for dev
      this.masterKey = pbkdf2Sync(passphrase, dbPath, 100000, 32, 'sha256');
      console.log('[jwt-auth] No MASTER_KEY set — using derived key (dev mode only).');
    }
  }

  /**
   * Encrypt a secret using AES-256-CBC with the master key.
   */
  private encryptSecret(secret: string): string {
    if (!this.masterKey) {
      throw new Error('Master key not initialized');
    }

    const iv = randomBytes(16);
    const cipher = createCipheriv('aes-256-cbc', this.masterKey, iv);
    let encrypted = cipher.update(secret, 'utf8', 'hex');
    encrypted += cipher.final('hex');

    // Return iv:encrypted format
    return `${iv.toString('hex')}:${encrypted}`;
  }

  /**
   * Decrypt a secret using AES-256-CBC with the master key.
   */
  private decryptSecret(encrypted: string): string {
    if (!this.masterKey) {
      throw new Error('Master key not initialized');
    }

    const [ivHex, encryptedData] = encrypted.split(':');
    if (!ivHex || !encryptedData) {
      throw new Error('Invalid encrypted secret format');
    }

    const decipher = createDecipheriv('aes-256-cbc', this.masterKey, Buffer.from(ivHex, 'hex'));
    let decrypted = decipher.update(encryptedData, 'hex', 'utf8');
    decrypted += decipher.final('utf8');

    return decrypted;
  }

  /**
   * Initialize or retrieve JWT secret from sync_state table.
   * Returns the secret (for inspection/debug only — never expose to client).
   */
  initialize(): string {
    // Try to load existing secret
    const rows = this.db.exec("SELECT value FROM sync_state WHERE key = 'jwt_secret'");
    if (rows.length && rows[0].values.length) {
      const storedValue = rows[0].values[0][0] as string;

      // Check if encrypted (contains ':' separator)
      if (storedValue.includes(':')) {
        try {
          this.secret = this.decryptSecret(storedValue);
          console.log('[jwt-auth] Loaded and decrypted JWT secret from database.');
        } catch (err) {
          console.error('[jwt-auth] Failed to decrypt secret — may need to regenerate:', err);
          throw new Error('Failed to decrypt JWT secret — check MASTER_KEY');
        }
      } else {
        // Plaintext secret (legacy or dev mode) — migrate to encrypted
        this.secret = storedValue;
        console.log('[jwt-auth] Loaded plaintext JWT secret — migrating to encrypted storage.');

        const encrypted = this.encryptSecret(this.secret);
        this.db.run(
          "UPDATE sync_state SET value = ? WHERE key = 'jwt_secret'",
          [encrypted]
        );

        // Persist migration
        const data = this.db.export();
        const fs = require('fs');
        const path = require('path');
        const dbPath = process.env['DB_PATH'] ?? 'C:/Users/awictor/shared-brain/data/brain.db';
        fs.writeFileSync(dbPath, Buffer.from(data));

        console.log('[jwt-auth] Migrated JWT secret to encrypted storage.');
      }

      // Load revoked tokens from DB
      this.loadRevokedTokens();

      return this.secret;
    }

    // Generate new secret (32 bytes = 256 bits)
    this.secret = randomBytes(32).toString('base64');

    // Encrypt before storing
    const encrypted = this.encryptSecret(this.secret);
    this.db.run(
      "INSERT INTO sync_state (key, value) VALUES ('jwt_secret', ?)",
      [encrypted]
    );

    // Create revoked_tokens table
    this.createRevokedTokensTable();

    // Persist to disk (sql.js in-memory requires explicit save)
    const data = this.db.export();
    const fs = require('fs');
    const path = require('path');
    const dbPath = process.env['DB_PATH'] ?? 'C:/Users/awictor/shared-brain/data/brain.db';
    const dir = path.dirname(dbPath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(dbPath, Buffer.from(data));

    console.log('[jwt-auth] Generated and stored new encrypted JWT secret.');
    return this.secret;
  }

  /**
   * Create revoked_tokens table if it doesn't exist.
   */
  private createRevokedTokensTable(): void {
    this.db.run(`
      CREATE TABLE IF NOT EXISTS revoked_tokens (
        jti TEXT PRIMARY KEY,
        revoked_at INTEGER NOT NULL,
        expires_at INTEGER NOT NULL
      )
    `);
  }

  /**
   * Load revoked tokens from DB into memory cache.
   */
  private loadRevokedTokens(): void {
    this.createRevokedTokensTable();
    const now = Math.floor(Date.now() / 1000);

    // Load only non-expired revoked tokens
    const rows = this.db.exec(`
      SELECT jti FROM revoked_tokens WHERE expires_at > ${now}
    `);

    if (rows.length && rows[0].values.length) {
      this.revokedTokens = new Set(rows[0].values.map((row: any[]) => row[0] as string));
      console.log(`[jwt-auth] Loaded ${this.revokedTokens.size} revoked tokens.`);
    }

    // Cleanup expired tokens
    this.db.run(`DELETE FROM revoked_tokens WHERE expires_at <= ${now}`);
  }

  /**
   * Issue a signed JWT token for the given userId/userName.
   * Expires in 30 days.
   */
  issueToken(userId: string, userName: string): string {
    if (!this.secret) {
      throw new Error('JWTAuth not initialized — call initialize() first');
    }

    // Generate unique JWT ID for revocation
    const jti = randomBytes(16).toString('hex');

    const payload: Pick<JWTPayload, 'userId' | 'userName' | 'jti'> = { userId, userName, jti };
    return jwt.sign(payload, this.secret, {
      expiresIn: '30d',
      issuer: 'shared-brain-server',
      audience: 'shared-brain-mcp',
    });
  }

  /**
   * Verify and decode a JWT token.
   * Returns the payload if valid, null if invalid/expired/revoked.
   */
  verifyToken(token: string): JWTPayload | null {
    if (!this.secret) {
      throw new Error('JWTAuth not initialized — call initialize() first');
    }

    try {
      const decoded = jwt.verify(token, this.secret, {
        issuer: 'shared-brain-server',
        audience: 'shared-brain-mcp',
      }) as JWTPayload;

      // Check if token is revoked
      if (decoded.jti && this.revokedTokens.has(decoded.jti)) {
        console.log(`[jwt-auth] Token revoked: jti=${decoded.jti}`);
        return null;
      }

      return decoded;
    } catch (err) {
      // Token invalid, expired, or tampered
      return null;
    }
  }

  /**
   * Revoke a token by adding its JTI to the revocation set.
   * Returns true if successfully revoked, false if token invalid.
   */
  revokeToken(token: string): boolean {
    if (!this.secret) {
      throw new Error('JWTAuth not initialized — call initialize() first');
    }

    try {
      // Decode without verifying (we want to revoke even if expired)
      const decoded = jwt.decode(token) as JWTPayload;

      if (!decoded || !decoded.jti) {
        console.log('[jwt-auth] Cannot revoke token: no JTI found');
        return false;
      }

      // Add to in-memory set
      this.revokedTokens.add(decoded.jti);

      // Persist to DB
      const now = Math.floor(Date.now() / 1000);
      const expiresAt = decoded.exp || (now + 30 * 24 * 60 * 60); // 30 days default

      this.db.run(
        "INSERT OR IGNORE INTO revoked_tokens (jti, revoked_at, expires_at) VALUES (?, ?, ?)",
        [decoded.jti, now, expiresAt]
      );

      // Persist to disk
      const data = this.db.export();
      const fs = require('fs');
      const path = require('path');
      const dbPath = process.env['DB_PATH'] ?? 'C:/Users/awictor/shared-brain/data/brain.db';
      fs.writeFileSync(dbPath, Buffer.from(data));

      console.log(`[jwt-auth] Token revoked: jti=${decoded.jti}, userId=${decoded.userId}`);
      return true;
    } catch (err) {
      console.error('[jwt-auth] Failed to revoke token:', err);
      return false;
    }
  }

  /**
   * Cleanup expired tokens from revocation set (called periodically).
   */
  cleanupExpiredRevocations(): number {
    const now = Math.floor(Date.now() / 1000);

    // Remove from DB
    this.db.run(`DELETE FROM revoked_tokens WHERE expires_at <= ${now}`);

    // Reload from DB to sync in-memory set
    this.loadRevokedTokens();

    console.log(`[jwt-auth] Cleaned up expired revocations. Current count: ${this.revokedTokens.size}`);
    return this.revokedTokens.size;
  }

  /**
   * Express middleware for /mcp route.
   *
   * 1. Check Authorization: Bearer <jwt> header
   * 2. If valid JWT: extract userId/userName and attach to req
   * 3. If no JWT and localhost (127.0.0.1): fall back to X-User-Id header (dev mode)
   * 4. If no JWT and NOT localhost: return 401 Unauthorized
   */
  middleware(): RequestHandler {
    return (req: Request, res: Response, next: NextFunction): void => {
      const authHeader = req.headers['authorization'];

      // Try JWT first
      if (authHeader?.startsWith('Bearer ')) {
        const token = authHeader.slice(7);
        const payload = this.verifyToken(token);

        if (payload) {
          // Valid JWT — attach user info to request
          (req as any).userId = payload.userId;
          (req as any).userName = payload.userName;
          next();
          return;
        } else {
          // Invalid/expired JWT
          res.status(401).json({ error: 'Invalid or expired JWT token' });
          return;
        }
      }

      // No JWT — check if localhost for backwards compat
      const clientIp = req.ip || req.socket.remoteAddress || '';
      const isLocalhost =
        clientIp === '127.0.0.1' ||
        clientIp === '::1' ||
        clientIp === '::ffff:127.0.0.1' ||
        req.hostname === 'localhost';

      if (isLocalhost) {
        // Localhost fallback — trust X-User-Id header (for local dev/testing)
        const userId = (req.headers['x-user-id'] as string) ?? 'anonymous';
        const userName = (req.headers['x-user-name'] as string) ?? userId;
        (req as any).userId = userId;
        (req as any).userName = userName;
        console.log(`[jwt-auth] Localhost fallback: userId=${userId}`);
        next();
        return;
      }

      // No JWT and not localhost → reject
      res.status(401).json({ error: 'Unauthorized: JWT token required' });
    };
  }
}
