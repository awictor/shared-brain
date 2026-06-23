#!/usr/bin/env node
/**
 * Stdio-to-HTTP proxy for SharedBrain MCP server.
 * Reads JSON-RPC from stdin, POSTs to http://127.0.0.1:3100/mcp, writes response to stdout.
 */

const MCP_URL = 'http://127.0.0.1:3100/mcp';

let buffer = '';

process.stdin.setEncoding('utf8');
process.stdin.on('data', (chunk) => {
  buffer += chunk;
  const lines = buffer.split('\n');
  buffer = lines.pop(); // keep incomplete last line in buffer

  for (const line of lines) {
    if (!line.trim()) continue;
    handleMessage(line);
  }
});

process.stdin.on('end', () => {
  if (buffer.trim()) handleMessage(buffer);
});

async function handleMessage(line) {
  try {
    const parsed = JSON.parse(line);

    const resp = await fetch(MCP_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json, text/event-stream',
      },
      body: line,
    });

    const text = await resp.text();
    const dataLines = text.split('\n').filter(l => l.startsWith('data: '));

    for (const dataLine of dataLines) {
      const json = dataLine.slice(6);
      process.stdout.write(json + '\n');
    }

    // If no SSE data lines found, try parsing as plain JSON
    if (dataLines.length === 0 && text.trim()) {
      process.stdout.write(text.trim() + '\n');
    }
  } catch (err) {
    try {
      const parsed = JSON.parse(line);
      process.stdout.write(JSON.stringify({
        jsonrpc: '2.0',
        error: { code: -32603, message: String(err.message || err) },
        id: parsed.id ?? null,
      }) + '\n');
    } catch {
      process.stderr.write(`Proxy error: ${err}\n`);
    }
  }
}
