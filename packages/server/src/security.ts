/**
 * Security Layer for SharedBrain — zero-config hardening for multi-user deployment.
 *
 * Features:
 * - Auto-generated auth tokens (persisted in DB + file)
 * - Sliding-window rate limiting (in-memory, no Redis)
 * - Input sanitization (XSS prevention, length limits)
 * - Structured audit logging (SQLite)
 * - CORS lockdown (auto-detect dev vs. production)
 * - Security headers (nosniff, DENY, CSP, X-Request-Id)
 */

import { randomBytes, randomUUID } from 'crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { dirname } from 'path';
import type { Request, Response, NextFunction, RequestHandler } from 'express';

// ─── Types ──────────────────────────────────────────────────────────────────

export interface SecurityConfig {
  autoToken: boolean;       // default true
  rateLimiting: boolean;    // default true
  auditLog: boolean;        // default true
  maxContentLength: number; // default 50000 (50KB)
}

export interface AuditEntry {
  id: string;
  timestamp: string;
  method: string;
  path: string;
  toolName: string | null;
  agentId: string | null;
  ip: string;
  statusCode: number;
  durationMs: number;
  error: string | null;
}

export interface RateLimitInfo {
  ip: string;
  endpoint: string;
  count: number;
  windowStart: number;
  limit: number;
  remaining: number;
}

// ─── Constants ──────────────────────────────────────────────────────────────

const AUDIT_SCHEMA = `
CREATE TABLE IF NOT EXISTS audit_log (
  id TEXT PRIMARY KEY,
  timestamp TEXT NOT NULL,
  method TEXT NOT NULL,
  path TEXT NOT NULL,
  tool_name TEXT,
  agent_id TEXT,
  ip TEXT NOT NULL,
  status_code INTEGER NOT NULL DEFAULT 0,
  duration_ms REAL NOT NULL DEFAULT 0,
  error TEXT
);

CREATE INDEX IF NOT EXISTS idx_audit_timestamp ON audit_log(timestamp);
CREATE INDEX IF NOT EXISTS idx_audit_agent ON audit_log(agent_id);
`;

const DEFAULT_CONFIG: SecurityConfig = {
  autoToken: true,
  rateLimiting: true,
  auditLog: true,
  maxContentLength: 50000,
};

// ─── Rate Limiter (sliding window, in-memory) ───────────────────────────────

interface WindowEntry {
  timestamps: number[];
}

class SlidingWindowRateLimiter {
  private windows: Map<string, WindowEntry> = new Map();
  private cleanupInterval: ReturnType<typeof setInterval>;

  constructor() {
    // Auto-clean expired windows every 60s
    this.cleanupInterval = setInterval(() => this.cleanup(), 60_000);
  }

  /**
   * Check if a request should be allowed.
   * Returns { allowed, remaining, retryAfterMs }
   */
  check(key: string, limit: number, windowMs: number): { allowed: boolean; remaining: number; retryAfterMs: number } {
    const now = Date.now();
    const windowStart = now - windowMs;

    let entry = this.windows.get(key);
    if (!entry) {
      entry = { timestamps: [] };
      this.windows.set(key, entry);
    }

    // Remove timestamps outside the window
    entry.timestamps = entry.timestamps.filter(t => t > windowStart);

    if (entry.timestamps.length >= limit) {
      // Calculate when the oldest request in window expires
      const oldestInWindow = entry.timestamps[0];
      const retryAfterMs = oldestInWindow + windowMs - now;
      return { allowed: false, remaining: 0, retryAfterMs: Math.max(1000, retryAfterMs) };
    }

    entry.timestamps.push(now);
    return { allowed: true, remaining: limit - entry.timestamps.length, retryAfterMs: 0 };
  }

  /** Get all active rate limit info (for dashboard) */
  getStatus(): RateLimitInfo[] {
    const results: RateLimitInfo[] = [];
    for (const [key, entry] of this.windows.entries()) {
      const [ip, endpoint, limitStr, windowStr] = key.split('|');
      const limit = parseInt(limitStr || '100', 10);
      const windowMs = parseInt(windowStr || '60000', 10);
      const now = Date.now();
      const active = entry.timestamps.filter(t => t > now - windowMs);
      if (active.length > 0) {
        results.push({
          ip,
          endpoint: endpoint || '/',
          count: active.length,
          windowStart: active[0],
          limit,
          remaining: Math.max(0, limit - active.length),
        });
      }
    }
    return results;
  }

  private cleanup(): void {
    const now = Date.now();
    const maxWindow = 5 * 60_000; // 5 minutes — max possible window
    for (const [key, entry] of this.windows.entries()) {
      entry.timestamps = entry.timestamps.filter(t => t > now - maxWindow);
      if (entry.timestamps.length === 0) {
        this.windows.delete(key);
      }
    }
  }

  destroy(): void {
    clearInterval(this.cleanupInterval);
  }
}

// ─── Input Sanitizer ────────────────────────────────────────────────────────

function stripHtmlTags(input: string): string {
  return input
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<[^>]*>/g, '')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
    .replace(/javascript:/gi, '')
    .replace(/on\w+\s*=/gi, '');
}

interface SanitizationResult {
  valid: boolean;
  errors: string[];
  sanitized: any;
}

function sanitizeMemoryInput(body: any, maxContentLength: number): SanitizationResult {
  const errors: string[] = [];
  const sanitized = { ...body };

  // Content length check
  if (sanitized.content) {
    if (typeof sanitized.content !== 'string') {
      errors.push('content must be a string');
    } else {
      if (sanitized.content.length > maxContentLength) {
        errors.push(`content exceeds maximum length of ${maxContentLength} characters (got ${sanitized.content.length})`);
      }
      sanitized.content = stripHtmlTags(sanitized.content);
    }
  }

  // Title length check
  if (sanitized.title) {
    if (typeof sanitized.title !== 'string') {
      errors.push('title must be a string');
    } else {
      if (sanitized.title.length > 200) {
        errors.push(`title exceeds maximum length of 200 characters (got ${sanitized.title.length})`);
      }
      sanitized.title = stripHtmlTags(sanitized.title).slice(0, 200);
    }
  }

  // Tags validation
  if (sanitized.tags) {
    if (!Array.isArray(sanitized.tags)) {
      errors.push('tags must be an array');
    } else {
      if (sanitized.tags.length > 20) {
        errors.push(`too many tags: maximum 20 allowed (got ${sanitized.tags.length})`);
      }
      const invalidTags = sanitized.tags.filter((t: any) => typeof t === 'string' && t.length > 50);
      if (invalidTags.length > 0) {
        errors.push(`${invalidTags.length} tag(s) exceed maximum length of 50 characters`);
      }
      sanitized.tags = sanitized.tags
        .filter((t: any) => typeof t === 'string')
        .slice(0, 20)
        .map((t: string) => stripHtmlTags(t).slice(0, 50));
    }
  }

  return { valid: errors.length === 0, errors, sanitized };
}

// ─── Security Layer Class ───────────────────────────────────────────────────

export class SecurityLayer {
  private db: any;
  private config: SecurityConfig;
  private rateLimiter: SlidingWindowRateLimiter;
  private tokenStatus: 'auto-generated' | 'manual' | 'none' = 'none';

  constructor(db: any, config?: Partial<SecurityConfig>) {
    this.db = db;
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.rateLimiter = new SlidingWindowRateLimiter();
  }

  // ─── Initialization ─────────────────────────────────────────────────────

  /**
   * Initialize security layer:
   * - Create audit_log table
   * - Auto-generate auth token if needed
   * - Clean up old audit entries
   * Returns the active auth token (or null if disabled)
   */
  initialize(): { token: string | null } {
    // Create audit table
    if (this.config.auditLog) {
      this.db.run(AUDIT_SCHEMA);
    }

    // Auto-rotate: delete entries older than 30 days
    this.cleanup();

    // Handle auth token
    let token: string | null = null;

    if (this.config.autoToken) {
      const envToken = process.env['AUTH_TOKEN'];
      if (envToken) {
        this.tokenStatus = 'manual';
        token = envToken;
        console.log('[security] Using AUTH_TOKEN from environment');
      } else {
        // Check if we have a stored token
        const rows = this.db.exec("SELECT value FROM sync_state WHERE key = 'auth_token'");
        if (rows.length && rows[0].values.length) {
          token = rows[0].values[0][0] as string;
          this.tokenStatus = 'auto-generated';
          console.log('[security] Loaded existing auto-generated token from database');
        } else {
          // Generate new token
          token = randomBytes(32).toString('hex');
          this.db.run(
            "INSERT OR REPLACE INTO sync_state (key, value) VALUES ('auth_token', ?)",
            [token]
          );

          // Write to file
          const tokenDir = 'C:/Users/awictor/shared-brain/data';
          const tokenPath = `${tokenDir}/auth.token`;
          if (!existsSync(tokenDir)) mkdirSync(tokenDir, { recursive: true });
          writeFileSync(tokenPath, token, 'utf8');

          this.tokenStatus = 'auto-generated';
          console.log(`[security] Generated new auth token → ${tokenPath}`);
          console.log('[security] Use this token in Authorization: Bearer <token> header');
        }
      }
    }

    console.log(`[security] Rate limiting: ${this.config.rateLimiting ? 'ENABLED' : 'DISABLED'}`);
    console.log(`[security] Audit logging: ${this.config.auditLog ? 'ENABLED' : 'DISABLED'}`);
    console.log(`[security] Max content length: ${this.config.maxContentLength} bytes`);

    return { token };
  }

  // ─── Middleware: Rate Limiting ──────────────────────────────────────────

  /**
   * Create rate-limiting middleware for a route.
   * @param limit Max requests per window
   * @param windowMs Window size in milliseconds (default 60000 = 1 minute)
   */
  rateLimitMiddleware(limit: number, windowMs: number = 60_000): RequestHandler {
    return (req: Request, res: Response, next: NextFunction): void => {
      if (!this.config.rateLimiting) {
        next();
        return;
      }

      const ip = req.ip || req.socket.remoteAddress || 'unknown';
      const endpoint = req.baseUrl || req.path;
      const key = `${ip}|${endpoint}|${limit}|${windowMs}`;

      const result = this.rateLimiter.check(key, limit, windowMs);

      // Always set rate limit headers
      res.setHeader('X-RateLimit-Limit', limit.toString());
      res.setHeader('X-RateLimit-Remaining', result.remaining.toString());
      res.setHeader('X-RateLimit-Reset', Math.ceil((Date.now() + windowMs) / 1000).toString());

      if (!result.allowed) {
        const retryAfterSec = Math.ceil(result.retryAfterMs / 1000);
        res.setHeader('Retry-After', retryAfterSec.toString());
        res.status(429).json({
          error: 'Too Many Requests',
          message: `Rate limit exceeded. Maximum ${limit} requests per ${windowMs / 1000}s.`,
          retryAfter: retryAfterSec,
        });
        return;
      }

      next();
    };
  }

  // ─── Middleware: Input Sanitization ─────────────────────────────────────

  /**
   * Middleware that sanitizes memory content in request bodies.
   * Applies to POST/PUT/PATCH requests with JSON bodies.
   */
  sanitizeMiddleware(): RequestHandler {
    return (req: Request, res: Response, next: NextFunction): void => {
      if (!req.body || !['POST', 'PUT', 'PATCH'].includes(req.method)) {
        next();
        return;
      }

      const result = sanitizeMemoryInput(req.body, this.config.maxContentLength);

      if (!result.valid) {
        res.status(400).json({
          error: 'Input Validation Failed',
          violations: result.errors,
        });
        return;
      }

      // Replace body with sanitized version
      req.body = result.sanitized;
      next();
    };
  }

  // ─── Middleware: Audit Logging ──────────────────────────────────────────

  /**
   * Middleware that logs every request to the audit_log table.
   */
  auditMiddleware(): RequestHandler {
    return (req: Request, res: Response, next: NextFunction): void => {
      if (!this.config.auditLog) {
        next();
        return;
      }

      const startTime = Date.now();
      const requestId = randomUUID();

      // Attach request ID for tracing
      res.setHeader('X-Request-Id', requestId);

      // Extract tool name from MCP request body
      let toolName: string | null = null;
      let agentId: string | null = null;

      if (req.body) {
        if (req.body.method === 'tools/call' && req.body.params?.name) {
          toolName = req.body.params.name;
        }
        if (req.body.params?.arguments?._meta?.agentId) {
          agentId = req.body.params.arguments._meta.agentId;
        }
        // Also check top-level agentId
        if (req.headers['x-agent-id']) {
          agentId = req.headers['x-agent-id'] as string;
        }
      }

      // Capture response finish
      const originalEnd = res.end.bind(res);
      res.end = ((...args: any[]) => {
        const duration = Date.now() - startTime;
        const ip = req.ip || req.socket.remoteAddress || 'unknown';

        try {
          this.db.run(
            `INSERT INTO audit_log (id, timestamp, method, path, tool_name, agent_id, ip, status_code, duration_ms, error)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [
              requestId,
              new Date().toISOString(),
              req.method,
              req.path,
              toolName,
              agentId,
              ip,
              res.statusCode,
              duration,
              res.statusCode >= 400 ? `HTTP ${res.statusCode}` : null,
            ]
          );
        } catch (e) {
          // Don't let audit failures break requests
          console.error('[security] Audit log write failed:', e);
        }

        return originalEnd(...args);
      }) as any;

      next();
    };
  }

  // ─── Middleware: Security Headers ───────────────────────────────────────

  /**
   * Add security headers to all responses.
   */
  securityHeadersMiddleware(): RequestHandler {
    return (_req: Request, res: Response, next: NextFunction): void => {
      res.setHeader('X-Content-Type-Options', 'nosniff');
      res.setHeader('X-Frame-Options', 'DENY');
      res.setHeader('Content-Security-Policy', "default-src 'self' 'unsafe-inline'");
      res.setHeader('X-Request-Id', res.getHeader('X-Request-Id') || randomUUID());
      next();
    };
  }

  // ─── Middleware: CORS Lockdown ──────────────────────────────────────────

  /**
   * Returns CORS options based on environment.
   * Localhost/127.0.0.1 → allow all origins (dev mode)
   * Anything else → same-origin only
   */
  getCorsOptions(host: string): { origin: boolean | string } {
    const isLocal = host === '127.0.0.1' || host === 'localhost' || host === '::1';
    if (isLocal) {
      return { origin: true }; // Allow all origins in dev
    }
    return { origin: false }; // Same-origin only in production
  }

  // ─── Audit Log Query ───────────────────────────────────────────────────

  /**
   * Get recent audit log entries.
   */
  getAuditLog(limit: number = 100): AuditEntry[] {
    try {
      const rows = this.db.exec(
        'SELECT * FROM audit_log ORDER BY timestamp DESC LIMIT ?',
        [limit]
      );
      if (!rows.length) return [];
      return rows[0].values.map((row: any[]) => {
        const cols = rows[0].columns;
        const r = Object.fromEntries(cols.map((c: string, i: number) => [c, row[i]])) as any;
        return {
          id: r.id,
          timestamp: r.timestamp,
          method: r.method,
          path: r.path,
          toolName: r.tool_name,
          agentId: r.agent_id,
          ip: r.ip,
          statusCode: r.status_code,
          durationMs: r.duration_ms,
          error: r.error,
        };
      });
    } catch {
      return [];
    }
  }

  /**
   * Get rate limit status for dashboard.
   */
  getRateLimitStatus(): RateLimitInfo[] {
    return this.rateLimiter.getStatus();
  }

  /**
   * Get current security configuration status.
   */
  getStatus(): {
    config: SecurityConfig;
    tokenStatus: string;
    auditEntryCount: number;
    rateLimitWindowsActive: number;
  } {
    let auditCount = 0;
    try {
      const rows = this.db.exec('SELECT COUNT(*) FROM audit_log');
      auditCount = rows[0]?.values[0]?.[0] ?? 0;
    } catch { /* table may not exist yet */ }

    return {
      config: this.config,
      tokenStatus: this.tokenStatus,
      auditEntryCount: auditCount,
      rateLimitWindowsActive: this.rateLimiter.getStatus().length,
    };
  }

  /**
   * Comprehensive security audit — returns current security posture as JSON.
   * Checks: CORS config, JWT settings, rate limits, data encryption, endpoint exposure.
   */
  securityAudit(): {
    timestamp: string;
    overallRisk: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
    findings: Array<{
      category: string;
      severity: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
      status: 'PASS' | 'WARN' | 'FAIL';
      message: string;
      recommendation?: string;
    }>;
    summary: {
      critical: number;
      high: number;
      medium: number;
      low: number;
      passed: number;
    };
  } {
    const findings: Array<{
      category: string;
      severity: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
      status: 'PASS' | 'WARN' | 'FAIL';
      message: string;
      recommendation?: string;
    }> = [];

    // Check 1: CORS Configuration
    const nodeEnv = process.env['NODE_ENV'] ?? 'development';
    const allowedOrigins = process.env['ALLOWED_ORIGINS'];
    const isProduction = nodeEnv === 'production';

    if (isProduction && !allowedOrigins) {
      findings.push({
        category: 'CORS',
        severity: 'CRITICAL',
        status: 'FAIL',
        message: 'Production deployment with ALLOWED_ORIGINS=undefined allows any origin',
        recommendation: 'Set ALLOWED_ORIGINS env var to comma-separated whitelist',
      });
    } else if (!isProduction && !allowedOrigins) {
      findings.push({
        category: 'CORS',
        severity: 'LOW',
        status: 'WARN',
        message: 'Development mode allows all origins (expected behavior)',
        recommendation: 'Ensure ALLOWED_ORIGINS is set before production deployment',
      });
    } else {
      findings.push({
        category: 'CORS',
        severity: 'LOW',
        status: 'PASS',
        message: `CORS restricted to: ${allowedOrigins}`,
      });
    }

    // Check 2: JWT Secret Storage
    let jwtSecretExists = false;
    try {
      const rows = this.db.exec("SELECT value FROM sync_state WHERE key = 'jwt_secret'");
      jwtSecretExists = rows.length > 0 && rows[0].values.length > 0;
    } catch { /* table may not exist */ }

    if (jwtSecretExists) {
      const masterKey = process.env['MASTER_KEY'];
      if (!masterKey) {
        findings.push({
          category: 'Authentication',
          severity: 'CRITICAL',
          status: 'FAIL',
          message: 'JWT secret stored in plaintext (no MASTER_KEY for encryption)',
          recommendation: 'Set MASTER_KEY env var (32 bytes hex) and encrypt secrets',
        });
      } else {
        findings.push({
          category: 'Authentication',
          severity: 'LOW',
          status: 'PASS',
          message: 'JWT secret encryption key configured',
        });
      }
    }

    // Check 3: Rate Limiting
    if (!this.config.rateLimiting) {
      findings.push({
        category: 'Rate Limiting',
        severity: 'HIGH',
        status: 'FAIL',
        message: 'Rate limiting disabled (rateLimiting: false)',
        recommendation: 'Enable rate limiting to prevent abuse',
      });
    } else {
      const activeWindows = this.rateLimiter.getStatus().length;
      findings.push({
        category: 'Rate Limiting',
        severity: 'LOW',
        status: 'PASS',
        message: `Rate limiting active (${activeWindows} windows tracked)`,
      });
    }

    // Check 4: Audit Logging
    if (!this.config.auditLog) {
      findings.push({
        category: 'Audit Logging',
        severity: 'MEDIUM',
        status: 'WARN',
        message: 'Audit logging disabled (auditLog: false)',
        recommendation: 'Enable audit logging for compliance and incident response',
      });
    } else {
      let auditCount = 0;
      try {
        const rows = this.db.exec('SELECT COUNT(*) FROM audit_log');
        auditCount = rows[0]?.values[0]?.[0] ?? 0;
      } catch { /* table may not exist */ }
      findings.push({
        category: 'Audit Logging',
        severity: 'LOW',
        status: 'PASS',
        message: `Audit logging enabled (${auditCount} entries)`,
      });
    }

    // Check 5: Content Size Limits
    if (this.config.maxContentLength > 1_000_000) {
      findings.push({
        category: 'Input Validation',
        severity: 'MEDIUM',
        status: 'WARN',
        message: `Max content length unusually high (${this.config.maxContentLength} bytes)`,
        recommendation: 'Reduce to 100KB or less to prevent resource exhaustion',
      });
    } else {
      findings.push({
        category: 'Input Validation',
        severity: 'LOW',
        status: 'PASS',
        message: `Content size limits enforced (${this.config.maxContentLength} bytes)`,
      });
    }

    // Check 6: Auto-Token Generation
    if (this.config.autoToken && this.tokenStatus === 'auto-generated') {
      findings.push({
        category: 'Authentication',
        severity: 'LOW',
        status: 'PASS',
        message: 'Auto-generated auth token active',
      });
    } else if (!this.config.autoToken) {
      findings.push({
        category: 'Authentication',
        severity: 'MEDIUM',
        status: 'WARN',
        message: 'Auto-token generation disabled (manual token management required)',
      });
    }

    // Check 7: Database Encryption
    // Note: Cannot directly detect SQLCipher from sql.js — check via env var hint
    const dbEncryptionKey = process.env['DB_ENCRYPTION_KEY'];
    if (isProduction && !dbEncryptionKey) {
      findings.push({
        category: 'Data at Rest',
        severity: 'HIGH',
        status: 'FAIL',
        message: 'Production database not encrypted (DB_ENCRYPTION_KEY not set)',
        recommendation: 'Use SQLCipher or encrypt data directory',
      });
    } else if (dbEncryptionKey) {
      findings.push({
        category: 'Data at Rest',
        severity: 'LOW',
        status: 'PASS',
        message: 'Database encryption key configured',
      });
    } else {
      findings.push({
        category: 'Data at Rest',
        severity: 'LOW',
        status: 'WARN',
        message: 'Database encryption not detected (acceptable in dev)',
      });
    }

    // Compute summary
    const summary = {
      critical: findings.filter(f => f.severity === 'CRITICAL').length,
      high: findings.filter(f => f.severity === 'HIGH').length,
      medium: findings.filter(f => f.severity === 'MEDIUM').length,
      low: findings.filter(f => f.severity === 'LOW').length,
      passed: findings.filter(f => f.status === 'PASS').length,
    };

    // Overall risk level
    let overallRisk: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL' = 'LOW';
    if (summary.critical > 0) overallRisk = 'CRITICAL';
    else if (summary.high > 0) overallRisk = 'HIGH';
    else if (summary.medium > 0) overallRisk = 'MEDIUM';

    return {
      timestamp: new Date().toISOString(),
      overallRisk,
      findings,
      summary,
    };
  }

  // ─── Cleanup ───────────────────────────────────────────────────────────

  /**
   * Delete audit entries older than 30 days.
   */
  cleanup(): void {
    if (!this.config.auditLog) return;

    try {
      const cutoff = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
      this.db.run('DELETE FROM audit_log WHERE timestamp < ?', [cutoff]);
      console.log(`[security] Cleaned up audit entries older than 30 days`);
    } catch {
      // Table may not exist yet on first run — that's fine
    }
  }

  /**
   * Destroy rate limiter timers (for graceful shutdown).
   */
  destroy(): void {
    this.rateLimiter.destroy();
  }
}

// ─── Exported Sanitization Utility (for use in other modules) ────────────────

export { sanitizeMemoryInput, stripHtmlTags };
