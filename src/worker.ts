import { createMcpServer } from './mcp.js';
import {
  WebStandardStreamableHTTPServerTransport
} from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js';
import type { Server } from '@modelcontextprotocol/sdk/server/index.js';

export default {
  async fetch(request: Request, env: { SUPADATA_API_KEY: string }, _ctx: any): Promise<Response> {
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
        console.error('CRITICAL: No API key provided via headers (x-api-key) or environment (SUPADATA_API_KEY).');
      } else {
        console.log(`Received API Key (length: ${apiKey.length})`);
      }

      const transport = new WebStandardStreamableHTTPServerTransport({
        sessionIdGenerator: undefined,
      });

      const result = createMcpServer({
        supadataApiKey: apiKey || '',
      });
      server = result.server;

      await server.connect(transport);

      if (apiKey) {
        const prefix = apiKey.substring(0, 4);
        const suffix = apiKey.substring(apiKey.length - 4);
        console.error(`Received API Key (length: ${apiKey.length}). Debug: ${prefix}...${suffix}`);
      } else {
        console.error('CRITICAL: API Key is empty!');
      }

      const url = new URL(request.url);
      if (url.pathname === '/' && request.method === 'GET') {
        return new Response('Supadata MCP Worker is running. Endpoint: /message or /sse', {
          status: 200,
          headers: { 'Content-Type': 'text/plain' }
        });
      }

      const response = await transport.handleRequest(request);
      return response ?? new Response('Not Found', { status: 404 });

    } catch (err: any) {
      console.error('Worker Error:', err);
      const actualEnvKey = env.SUPADATA_API_KEY ? 'Present' : 'Missing';
      const debugMsg = `Server Internal Error: ${err?.message}. Env Status: ${actualEnvKey}`;

      return new Response(
        JSON.stringify({
          error: debugMsg,
        }),
        { status: 500 }
      );
    } finally {
      if (server) {
        await server.close();
      }
    }
  },
};
