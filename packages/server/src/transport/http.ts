/**
 * Streamable HTTP transport — single /mcp endpoint for all MCP communication.
 * Stateless mode: creates a fresh McpServer + transport per request.
 */

import type { Application, Request, Response } from 'express';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import type { MemoryHandler } from '../mcp/handler.js';
import type { Store } from '../mcp/handler.js';

interface TransportDeps {
  handler: MemoryHandler;
  store: Store;
  registerTools: (server: McpServer, deps: { handler: MemoryHandler }) => void;
  registerResources: (server: McpServer, deps: { store: Store }) => void;
}

export function createHttpTransport(deps: TransportDeps, app: Application): void {
  const createMcpServer = () => {
    const server = new McpServer({
      name: 'shared-brain',
      version: '0.1.0',
    });
    deps.registerTools(server, { handler: deps.handler });
    deps.registerResources(server, { store: deps.store });
    return server;
  };

  app.post('/mcp', async (req: Request, res: Response) => {
    const server = createMcpServer();
    try {
      const transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: undefined,
      });
      await server.connect(transport);
      await transport.handleRequest(req, res, req.body);
      res.on('close', () => {
        transport.close();
        server.close();
      });
    } catch (error) {
      if (!res.headersSent) {
        res.status(500).json({
          jsonrpc: '2.0',
          error: {
            code: -32603,
            message: error instanceof Error ? error.message : 'Internal error',
          },
          id: null,
        });
      }
    }
  });

  app.get('/mcp', async (_req: Request, res: Response) => {
    res.writeHead(405).end(JSON.stringify({
      jsonrpc: '2.0',
      error: { code: -32000, message: 'Method not allowed.' },
      id: null,
    }));
  });

  app.delete('/mcp', async (_req: Request, res: Response) => {
    res.writeHead(405).end(JSON.stringify({
      jsonrpc: '2.0',
      error: { code: -32000, message: 'Method not allowed.' },
      id: null,
    }));
  });

  app.get('/health', (_req: Request, res: Response) => {
    res.json({
      status: 'ok',
      service: 'shared-brain',
      version: '0.1.0',
      timestamp: new Date().toISOString(),
    });
  });
}
