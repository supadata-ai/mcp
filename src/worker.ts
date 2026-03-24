import OAuthProvider from '@cloudflare/workers-oauth-provider';
import {
  WebStandardStreamableHTTPServerTransport
} from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js';
import type { Server } from '@modelcontextprotocol/sdk/server/index.js';

import { createMcpServer } from './mcp.js';
import { authHandler } from './auth-handler.js';

// Handle MCP requests with a direct API key (legacy / backward-compatible)
async function handleMcpWithApiKey(request: Request, apiKey: string): Promise<Response> {
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
    const transport = new WebStandardStreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
      enableJsonResponse: true,
    });

    const result = createMcpServer({ supadataApiKey: apiKey });
    server = result.server;

    await server.connect(transport);

    const response = await transport.handleRequest(request);
    return response ?? new Response('Not Found', { status: 404 });
  } catch (err: any) {
    console.error('Worker Error:', err);
    return new Response(
      JSON.stringify({ error: `Server Internal Error: ${err?.message}` }),
      { status: 500, headers: { 'Content-Type': 'application/json' } },
    );
  } finally {
    if (server) {
      await server.close();
    }
  }
}

// OAuth-authenticated MCP handler
// The OAuthProvider injects authenticated `props` (including apiKey) via the execution context
const mcpHandler = {
  async fetch(request: Request, env: any, ctx: any): Promise<Response> {
    const props = ctx?.props || {};
    const apiKey = props.apiKey as string;

    if (!apiKey) {
      return new Response(
        JSON.stringify({ error: 'No API key in OAuth context' }),
        { status: 401, headers: { 'Content-Type': 'application/json' } },
      );
    }

    return handleMcpWithApiKey(request, apiKey);
  },
};

export default {
  async fetch(request: Request, env: any, ctx: any): Promise<Response> {
    const url = new URL(request.url);

    // Health check
    if (url.pathname === '/' && request.method === 'GET') {
      return new Response('Supadata MCP Worker is running.', {
        status: 200,
        headers: { 'Content-Type': 'text/plain' },
      });
    }

    // Legacy API key support: if x-api-key header is present, bypass OAuth entirely
    const apiKey = request.headers.get('x-api-key')
      || request.headers.get('x-api-token')
      || request.headers.get('supadata-api-key');

    if (apiKey && url.pathname === '/mcp') {
      console.log(`Received API Key via header (length: ${apiKey.length})`);
      return handleMcpWithApiKey(request, apiKey);
    }

    // Also support SUPADATA_API_KEY env var for direct POST to /mcp (backward compat)
    if (!apiKey && env.SUPADATA_API_KEY && url.pathname === '/mcp' && request.method === 'POST') {
      console.log(`Using env SUPADATA_API_KEY (length: ${env.SUPADATA_API_KEY.length})`);
      return handleMcpWithApiKey(request, env.SUPADATA_API_KEY);
    }

    // Serve OAuth Protected Resource Metadata (RFC 9728)
    if (url.pathname === '/.well-known/oauth-protected-resource') {
      return new Response(
        JSON.stringify({
          resource: 'https://api.supadata.ai',
          authorization_servers: ['https://api.supadata.ai'],
          scopes_supported: ['mcp'],
          bearer_methods_supported: ['header'],
        }),
        {
          headers: {
            'Content-Type': 'application/json',
            'Access-Control-Allow-Origin': '*',
          },
        },
      );
    }

    // OAuth flow for everything else
    const provider = new OAuthProvider({
      apiRoute: '/mcp',
      apiHandler: mcpHandler,
      defaultHandler: authHandler,
      authorizeEndpoint: '/authorize',
      tokenEndpoint: '/token',
      clientRegistrationEndpoint: '/register',
      scopesSupported: ['mcp'],
      accessTokenTTL: 3600,       // 1 hour
      refreshTokenTTL: 2592000,   // 30 days
    });

    return provider.fetch(request, env, ctx);
  },
};
