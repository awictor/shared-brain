/**
 * JWT Authentication Tests
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { JWTAuth } from '../jwt-auth.js';
// @ts-ignore
import initSqlJs from 'sql.js';

describe('JWTAuth', () => {
  let db: any;
  let jwtAuth: JWTAuth;

  beforeEach(async () => {
    const SQL = await initSqlJs();
    db = new SQL.Database();
    db.run(`
      CREATE TABLE IF NOT EXISTS sync_state (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );
    `);
    jwtAuth = new JWTAuth(db);
  });

  it('should generate and store JWT secret on first initialization', () => {
    const secret = jwtAuth.initialize();
    expect(secret).toBeDefined();
    expect(secret.length).toBeGreaterThan(20);

    // Verify something is stored in database (may be encrypted)
    const rows = db.exec("SELECT value FROM sync_state WHERE key = 'jwt_secret'");
    expect(rows.length).toBe(1);
    expect(rows[0].values[0][0]).toBeDefined();
  });

  it('should reuse existing secret on subsequent initializations', () => {
    const secret1 = jwtAuth.initialize();
    const secret2 = jwtAuth.initialize();
    expect(secret1).toBe(secret2);
  });

  it('should issue valid JWT tokens', () => {
    jwtAuth.initialize();
    const token = jwtAuth.issueToken('alice', 'Alice Smith');
    expect(token).toBeDefined();
    expect(typeof token).toBe('string');
    expect(token.split('.').length).toBe(3); // JWT has 3 parts: header.payload.signature
  });

  it('should verify valid tokens and extract payload', () => {
    jwtAuth.initialize();
    const token = jwtAuth.issueToken('bob', 'Bob Jones');
    const payload = jwtAuth.verifyToken(token);

    expect(payload).toBeDefined();
    expect(payload?.userId).toBe('bob');
    expect(payload?.userName).toBe('Bob Jones');
    expect(payload?.iat).toBeDefined();
    expect(payload?.exp).toBeDefined();
  });

  it('should reject invalid tokens', () => {
    jwtAuth.initialize();
    const payload = jwtAuth.verifyToken('invalid.token.here');
    expect(payload).toBeNull();
  });

  it('should reject tampered tokens', () => {
    jwtAuth.initialize();
    const token = jwtAuth.issueToken('charlie', 'Charlie Brown');
    // Tamper with the token by changing a character
    const tamperedToken = token.slice(0, -5) + 'XXXXX';
    const payload = jwtAuth.verifyToken(tamperedToken);
    expect(payload).toBeNull();
  });

  it('should throw error if issueToken called before initialize', () => {
    const uninitializedAuth = new JWTAuth(db);
    expect(() => {
      uninitializedAuth.issueToken('dave', 'Dave Wilson');
    }).toThrow('JWTAuth not initialized');
  });

  it('should throw error if verifyToken called before initialize', () => {
    const uninitializedAuth = new JWTAuth(db);
    expect(() => {
      uninitializedAuth.verifyToken('some.token.here');
    }).toThrow('JWTAuth not initialized');
  });

  it('should include correct issuer and audience in tokens', () => {
    jwtAuth.initialize();
    const token = jwtAuth.issueToken('eve', 'Eve Martinez');

    // Decode without verification to inspect payload
    const [, payloadBase64] = token.split('.');
    const payload = JSON.parse(Buffer.from(payloadBase64, 'base64').toString('utf8'));

    expect(payload.iss).toBe('shared-brain-server');
    expect(payload.aud).toBe('shared-brain-mcp');
  });
});
