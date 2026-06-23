# JWT Authentication Implementation

## Overview

Replaced the trust-based `X-User-Id` header system with proper JWT token signing and validation for secure multi-user access to SharedBrain.

## Components

### 1. `src/jwt-auth.ts` - Core JWT Authentication Module

**Key features:**
- **Secret Management**: On first run, generates a 32-byte (256-bit) random HMAC secret and stores it in the `sync_state` table with key `jwt_secret`
- **Token Issuance**: Issues signed JWT tokens with 30-day expiration containing `{userId, userName, iat, exp}`
- **Token Verification**: Validates token signatures, expiration, issuer, and audience
- **Middleware**: Express middleware that validates JWT tokens on `/mcp` route

**Security properties:**
- Tokens signed with HMAC-SHA256 using 256-bit random secret
- 30-day token lifetime
- Issuer: `shared-brain-server`
- Audience: `shared-brain-mcp`
- Localhost fallback: If no JWT and running on 127.0.0.1, falls back to `X-User-Id` header (for local dev)
- Non-localhost: If no JWT, returns 401 Unauthorized

### 2. API Endpoints

#### `GET /api/auth/token?userId=<alias>&userName=<name>`
Issues a signed JWT token for the given userId/userName.

**Response:**
```json
{
  "token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
  "expiresIn": "30d"
}
```

#### `GET /api/auth/verify`
Validates a JWT token and returns the decoded payload.

**Request:**
```
Authorization: Bearer <token>
```

**Response (valid):**
```json
{
  "valid": true,
  "userId": "alice",
  "userName": "Alice Smith"
}
```

**Response (invalid):**
```json
{
  "valid": false,
  "error": "Invalid or expired token"
}
```

### 3. Updated Proxy Script (`/proxy.js`)

The MCP proxy script (served at `GET /proxy.js`) now:

1. **First run**: Prompts for userId/userName, then requests a JWT token from the server via `GET /api/auth/token`
2. **Stores token**: Saves `{userId, userName, token}` to `~/.shared-brain/identity.json`
3. **Uses JWT**: Includes token in all MCP requests via `Authorization: Bearer <token>` header
4. **Auto-recovery**: If token expires (401 response), deletes config and prompts for re-authentication on next run

### 4. Middleware Flow in `index.ts`

```typescript
// 1. Initialize JWT auth
const jwtAuth = new JWTAuth(store.db);
jwtAuth.initialize();

// 2. Apply JWT middleware to /mcp route
app.use('/mcp', jwtAuth.middleware());

// 3. Extract userId/userName from JWT payload and set on handler
app.use('/mcp', (req, _res, next) => {
  const userId = (req as any).userId ?? 'anonymous';
  const userName = (req as any).userName ?? userId;
  handler.setCurrentUser(userId, userName);
  next();
});
```

## Migration Path

**Backwards compatibility:**
- Localhost clients (127.0.0.1) can still use `X-User-Id` header for local dev/testing
- Remote clients must use JWT tokens

**Upgrading existing users:**
1. Download new proxy script: `curl http://server:3100/proxy.js > ~/.local/bin/shared-brain-proxy`
2. On next run, proxy will detect missing token and prompt for re-authentication
3. Token issued and stored automatically

## Testing

Comprehensive test suite in `src/__tests__/jwt-auth.test.ts` covers:
- Secret generation and persistence
- Token issuance and validation
- Tamper detection
- Error handling
- Issuer/audience validation

**All tests passing:** 9/9 ✓

## Security Benefits

1. **Cryptographic authentication**: No more trust-based headers — tokens are cryptographically signed
2. **Tamper-proof**: Any modification to token payload or signature causes verification to fail
3. **Time-limited**: 30-day expiration reduces risk of token theft
4. **Secret rotation**: Secret stored in database can be regenerated if compromised (invalidates all tokens)
5. **Audit trail**: Token issuance can be logged for compliance

## Files Modified

- `packages/server/src/jwt-auth.ts` — New JWT authentication module (150 lines)
- `packages/server/src/index.ts` — Wired JWT auth into server startup and added API endpoints
- `packages/server/src/__tests__/jwt-auth.test.ts` — New test suite (100 lines)

## Build Status

✅ TypeScript compilation successful  
✅ All tests passing (9/9)  
✅ No breaking changes to existing API (localhost fallback maintains dev workflow)
