/**
 * Server factory — wires together store, embeddings, MCP server, and Express app.
 */

import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import { createHttpTransport } from './transport/http.js';
import { registerTools } from './mcp/tools.js';
import { registerResources } from './mcp/resources.js';
import { authMiddleware } from './auth/middleware.js';
import { MemoryHandler } from './mcp/handler.js';
import type { Store, Embeddings, VectorIndex, FullTextIndex } from './mcp/handler.js';

export interface ServerConfig {
  port: number;
  host: string;
  dbPath: string;
  authToken?: string;
  modelsPath?: string;
  toolDeps?: Record<string, unknown>;
  allowedOrigins?: string[];
  skipInit?: boolean;
}

export interface ServerInstance {
  app: express.Application;
  store: Store;
  embeddings: Embeddings;
  vectorIndex: VectorIndex;
  handler: MemoryHandler;
}

export async function createServer(
  config: ServerConfig,
  deps: { store: Store; embeddings: Embeddings; vectorIndex: VectorIndex; fullTextIndex?: FullTextIndex; notificationManager?: any },
): Promise<ServerInstance> {
  const { store, embeddings, vectorIndex, fullTextIndex, notificationManager } = deps;

  if (!(config as any).skipInit) {
    await store.initialize();
    await embeddings.initialize();
  }

  // Pass versionManager if the store has one
  const versionManager = (store as any).versionManager ?? null;
  const handler = new MemoryHandler(store, embeddings, vectorIndex, fullTextIndex, versionManager, notificationManager);

  const app = express();
  app.use(helmet());

  // CORS configuration: strict whitelist in production, allow all in dev
  if (config.allowedOrigins && config.allowedOrigins.length > 0) {
    app.use(cors({
      origin: (origin, callback) => {
        // Allow requests with no origin (e.g., mobile apps, Postman)
        if (!origin) return callback(null, true);
        if (config.allowedOrigins!.includes(origin)) {
          callback(null, true);
        } else {
          callback(new Error(`CORS policy violation: origin ${origin} not allowed`));
        }
      },
      credentials: true,
      maxAge: 86400, // cache preflight for 24h
    }));
  } else {
    // Dev mode: allow all origins
    app.use(cors());
  }

  app.use(express.json({ limit: '10mb' }));

  if (config.authToken) {
    app.use('/mcp', authMiddleware(config.authToken));
  }

  createHttpTransport({ handler, store, registerTools, registerResources, toolDeps: config.toolDeps }, app);

  return { app, store, embeddings, vectorIndex, handler };
}
