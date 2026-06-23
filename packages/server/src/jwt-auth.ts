/**
 * JWT Authentication Layer for SharedBrain
 *
 * Replaces trust-based X-User-Id headers with proper JWT token signing and validation.
 *
 * Architecture:
 * - On first run: generates HMAC secret (32 random bytes) stored in sync_state table
 * - GET /api/auth/token?userId=alice&userName=Alice → issues signed JWT (30-day exp)
 * - Middleware on /mcp: validates Authorization: Bearer <jwt>, extracts userId/userName
 * - Localhost fallback: if no JWT and running on 127.0.0.1, falls back to X-User-Id header
 * - Non-localhost: if no JWT, returns 401 Unauthorized
 */

import jwt from 'jsonwebtoken';
import { randomBytes } from 'node:crypto';
import type { Request, Response, NextFunction, RequestHandler } from 'express';

export interface JWTPayload {
  userId: string;
  userName: string;
  iat: number;
  exp: number;
}

export class JWTAuth {
  private secret: string | null = null;

  constructor(private db: any) {}

  /**
   * Initialize or retrieve JWT secret from sync_state table.
   * Returns the secret (for inspection/debug only — never expose to client).
   */
  initialize(): string {
    // Try to load existing secret
    const rows = this.db.exec("SELECT value FROM sync_state WHERE key = 'jwt_secret'");
    if (rows.length && rows[0].values.length) {
      this.secret = rows[0].values[0][0] as string;
      console.log('[jwt-auth] Loaded existing JWT secret from database.');
      return this.secret;
    }

    // Generate new secret (32 bytes = 256 bits)
    this.secret = randomBytes(32).toString('base64');
    this.db.run(
      "INSERT INTO sync_state (key, value) VALUES ('jwt_secret', ?)",
      [this.secret]
    );

    // Persist to disk (sql.js in-memory requires explicit save)
    const data = this.db.export();
    const fs = require('fs');
    const path = require('path');
    const dbPath = process.env['DB_PATH'] ?? 'C:/Users/awictor/shared-brain/data/brain.db';
    const dir = path.dirname(dbPath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(dbPath, Buffer.from(data));

    console.log('[jwt-auth] Generated and stored new JWT secret.');
    return this.secret;
  }

  /**
   * Issue a signed JWT token for the given userId/userName.
   * Expires in 30 days.
   */
  issueToken(userId: string, userName: string): string {
    if (!this.secret) {
      throw new Error('JWTAuth not initialized — call initialize() first');
    }

    const payload: Omit<JWTPayload, 'iat' | 'exp'> = { userId, userName };
    return jwt.sign(payload, this.secret, {
      expiresIn: '30d',
      issuer: 'shared-brain-server',
      audience: 'shared-brain-mcp',
    });
  }

  /**
   * Verify and decode a JWT token.
   * Returns the payload if valid, null if invalid/expired.
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

      return decoded;
    } catch (err) {
      // Token invalid, expired, or tampered
      return null;
    }
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
