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
import type { Store, Embeddings, VectorIndex } from './mcp/handler.js';

export interface ServerConfig {
  port: number;
  host: string;
  dbPath: string;
  authToken?: string;
  modelsPath?: string;
  toolDeps?: Record<string, unknown>;
  allowedOrigins?: string[];
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
  deps: { store: Store; embeddings: Embeddings; vectorIndex: VectorIndex },
): Promise<ServerInstance> {
  const { store, embeddings, vectorIndex } = deps;

  await store.initialize();
  await embeddings.initialize();

  // Pass versionManager if the store has one
  const versionManager = (store as any).versionManager ?? null;
  const handler = new MemoryHandler(store, embeddings, vectorIndex, versionManager);

  const app = express();
  app.use(helmet());
  app.use(cors(config.allowedOrigins ? { origin: config.allowedOrigins } : undefined));
  app.use(express.json({ limit: '10mb' }));

  if (config.authToken) {
    app.use('/mcp', authMiddleware(config.authToken));
  }

  createHttpTransport({ handler, store, registerTools, registerResources, toolDeps: config.toolDeps }, app);

  return { app, store, embeddings, vectorIndex, handler };
}
