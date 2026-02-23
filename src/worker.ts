import { createMcpServer } from './mcp.js';
import {
  WebStandardStreamableHTTPServerTransport
} from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js';
import type { Server } from '@modelcontextprotocol/sdk/server/index.js';

export default {
  async fetch(request: Request, env: { SUPADATA_API_KEY: string }, _ctx: any): Promise<Response> {
    // Health check — no server/transport needed
    const url = new URL(request.url);
    if (url.pathname === '/' && request.method === 'GET') {
      return new Response('Supadata MCP Worker is running.', {
        status: 200,
        headers: { 'Content-Type': 'text/plain' },
      });
    }

    // In stateless mode, only POST is supported for JSON-RPC requests.
    // GET (SSE streams) and DELETE (session termination) don't work
    // because server.close() in the finally block would terminate them.
    if (request.method !== 'POST') {
      return new Response(
        JSON.stringify({
          jsonrpc: '2.0',
          error: {
            code: -32000,
            message: 'Method not allowed. Use POST for JSON-RPC requests.',
          },
          id: null,
        }),
        {
          status: 405,
          headers: { 'Content-Type': 'application/json', Allow: 'POST' },
        },
      );
    }

    let server: Server | null = null;

    try {
      let apiKey = request.headers.get('x-api-key');

      if (!apiKey) {
        apiKey = request.headers.get('x-api-token');
      }

      if (!apiKey) {
        apiKey = request.headers.get('supadata-api-key');
      }

      if (!apiKey) {
        apiKey = env.SUPADATA_API_KEY;
      }

      if (!apiKey) {
        console.warn('No API key provided via headers (x-api-key) or environment (SUPADATA_API_KEY).');
      } else {
        console.log(`Received API Key (length: ${apiKey.length})`);
      }

      const transport = new WebStandardStreamableHTTPServerTransport({
        sessionIdGenerator: undefined,
        enableJsonResponse: true,
      });

      const result = createMcpServer({
        supadataApiKey: apiKey || '',
      });
      server = result.server;

      await server.connect(transport);

      const response = await transport.handleRequest(request);
      return response ?? new Response('Not Found', { status: 404 });

    } catch (err: any) {
      console.error('Worker Error:', err);

      return new Response(
        JSON.stringify({
          error: `Server Internal Error: ${err?.message}`,
        }),
        { status: 500, headers: { 'Content-Type': 'application/json' } },
      );
    } finally {
      if (server) {
        await server.close();
      }
    }
  },
};
