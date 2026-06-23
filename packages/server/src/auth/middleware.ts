/**
 * Express middleware for bearer-token authentication.
 *
 * When enabled, all requests to protected routes must include:
 *   Authorization: Bearer <token>
 *
 * For local-only usage this middleware is skipped entirely.
 */

import type { Request, Response, NextFunction } from 'express';
import { generateTokenHash, validateToken } from './token.js';

/**
 * Create an auth middleware that validates bearer tokens.
 * The expectedToken is hashed once at startup for secure comparison.
 */
export function authMiddleware(expectedToken: string) {
  const expectedHash = generateTokenHash(expectedToken);

  return (req: Request, res: Response, next: NextFunction): void => {
    const authHeader = req.headers.authorization;

    if (!authHeader) {
      res.status(401).json({ error: 'Missing Authorization header' });
      return;
    }

    const parts = authHeader.split(' ');
    if (parts.length !== 2 || parts[0] !== 'Bearer') {
      res.status(401).json({ error: 'Invalid Authorization format. Expected: Bearer <token>' });
      return;
    }

    const token = parts[1];

    if (!validateToken(token, expectedHash)) {
      res.status(403).json({ error: 'Invalid token' });
      return;
    }

    next();
  };
}
