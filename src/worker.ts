import OAuthProvider from '@cloudflare/workers-oauth-provider';
import {
  WebStandardStreamableHTTPServerTransport
} from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js';
import type { Server } from '@modelcontextprotocol/sdk/server/index.js';

import { createMcpServer } from './mcp.js';
import { authHandler } from './auth-handler.js';
import { resolveClient } from './client.js';

const RESOURCE_METADATA_URL = 'https://api.supadata.ai/.well-known/oauth-protected-resource';

// The audience of every token the provider issues. Clients' own `resource`
// values are stripped (see below), so tokens always get this one. Grants and
// tokens written by 0.1.0 have no resource and are bound to it on their next
// refresh.
const RESOURCE = 'https://api.supadata.ai';

const DAY = 24 * 60 * 60;

// A connection lasts as long as it is used: every refresh moves the grant's
// expiry to 30 days ahead, so only a client idle for 30 days has to log in
// again. There is no absolute cap. The first lifetime, from the code exchange,
// is the same 30 days.
const REFRESH_TOKEN_IDLE_TTL = 30 * DAY;

// Discovery documents are static; /.well-known/oauth-authorization-server alone
// gets ~93k hits/day, so let clients and caches keep them for an hour.
const METADATA_CACHE_CONTROL = 'public, max-age=3600';

// OAuth Protected Resource Metadata (RFC 9728), keyed by well-known path.
// Path-aware clients (the MCP SDK, Cursor, Codex) first try the URL with the
// resource path appended. RFC 9728 §3.3 requires `resource` to equal the
// identifier the URL was built from, so the /mcp variant names /mcp. The value
// never reaches a token audience: `resource` is stripped before the grant and
// the token exchange (see below and auth-handler.ts).
// ChatGPT app directory domain verification. The verifier drops the MCP URL's
// path and fetches this from the origin root; the token is public by design.
const OPENAI_APPS_CHALLENGE_PATH = '/.well-known/openai-apps-challenge';
const OPENAI_APPS_CHALLENGE_TOKEN = 'aISjU07uP03oCvzddyqevt6uqiD5mGLQ05CQFNG0o_o';

const PROTECTED_RESOURCES: Record<string, string> = {
  '/.well-known/oauth-protected-resource': 'https://api.supadata.ai',
  '/.well-known/oauth-protected-resource/mcp': 'https://api.supadata.ai/mcp',
};

// Path-suffixed variant of the authorization server metadata (RFC 8414 §3.1),
// served with the same document as the root URL.
const AUTHORIZATION_SERVER_METADATA_PATHS = new Set([
  '/.well-known/oauth-authorization-server',
  '/.well-known/oauth-authorization-server/mcp',
]);

function withHeaders(response: Response, headers: Record<string, string>): Response {
  const result = new Response(response.body, response);
  for (const [name, value] of Object.entries(headers)) {
    result.headers.set(name, value);
  }
  return result;
}

// A rejected /mcp request tells the client it is the token that is bad
// (RFC 6750 §3.1) and where to re-authorize (RFC 9728 §5.1)
function invalidTokenResponse(description: string, headers: HeadersInit = {}): Response {
  const result = new Headers(headers);
  result.set('Content-Type', 'application/json');
  result.set(
    'WWW-Authenticate',
    `Bearer realm="OAuth", error="invalid_token", error_description="${description}", resource_metadata="${RESOURCE_METADATA_URL}"`,
  );
  return new Response(JSON.stringify({ error: 'invalid_token', error_description: description }), {
    status: 401,
    headers: result,
  });
}

function daysSince(seconds: number, now: number): number {
  return Math.round(((now - seconds) / DAY) * 10) / 10;
}

// The client_id of a token request: in the body for public clients, or the
// username of HTTP Basic auth for confidential ones
function tokenRequestClientId(request: Request, params: URLSearchParams): string | null {
  const authorization = request.headers.get('authorization');
  if (authorization?.startsWith('Basic ')) {
    try {
      return decodeURIComponent(atob(authorization.slice(6)).split(':')[0]);
    } catch {
      return null;
    }
  }
  return params.get('client_id');
}

// Structured log line for a failed /oauth/token request, to tell expired
// grants from refresh-token reuse. Codes and refresh tokens have the form
// `<userId>:<grantId>:<secret>`; only the grant is looked up, nothing secret
// or user-identifying is logged.
async function logTokenError(
  env: any,
  request: Request,
  params: URLSearchParams,
  response: Response,
): Promise<void> {
  const now = Math.floor(Date.now() / 1000);
  const grantType = params.get('grant_type');
  const clientId = tokenRequestClientId(request, params);
  const { error, error_description: description } = (await response
    .clone()
    .json()
    .catch(() => ({}))) as { error?: string; error_description?: string };

  const client = clientId
    ? ((await env.OAUTH_KV.get(`client:${clientId}`, { type: 'json' }).catch(() => null)) as any)
    : null;

  const credential = grantType === 'refresh_token' ? params.get('refresh_token') : params.get('code');
  const [userId, grantId] = credential?.split(':') ?? [];
  const grant =
    userId && grantId
      ? ((await env.OAUTH_KV.get(`grant:${userId}:${grantId}`, { type: 'json' }).catch(() => null)) as any)
      : null;

  console.warn('[OAuth Token Error]', JSON.stringify({
    status: response.status,
    error,
    description,
    grantType,
    clientId,
    clientName: client?.clientName ?? null,
    clientAgeDays: client?.registrationDate ? daysSince(client.registrationDate, now) : null,
    userAgent: request.headers.get('user-agent'),
    grantExists: grantId ? Boolean(grant) : null,
    grantAgeDays: grant?.createdAt ? daysSince(grant.createdAt, now) : null,
    grantExpiresInDays: grant?.expiresAt ? -daysSince(grant.expiresAt, now) : null,
    grantRefreshed: grant ? Boolean(grant.previousRefreshTokenId) : null,
  }));
}

// Handle MCP requests with a direct API key (legacy / backward-compatible).
// `clientName` is the OAuth client's registered name, when known.
async function handleMcpWithApiKey(request: Request, apiKey: string, clientName?: string): Promise<Response> {
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

    const result = createMcpServer({
      supadataApiKey: apiKey,
      client: resolveClient(request.headers, clientName),
      transport: 'hosted',
    });
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
        JSON.stringify({ error: 'invalid_token', error_description: 'No API key in OAuth context' }),
        {
          status: 401,
          headers: {
            'Content-Type': 'application/json',
            'WWW-Authenticate': `Bearer error="invalid_token", resource_metadata="${RESOURCE_METADATA_URL}"`,
          },
        },
      );
    }

    // Grants issued before clientName was stored rely on header detection alone.
    return handleMcpWithApiKey(request, apiKey, props.clientName);
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

    if (url.pathname === OPENAI_APPS_CHALLENGE_PATH) {
      return new Response(OPENAI_APPS_CHALLENGE_TOKEN, {
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
    const protectedResource = PROTECTED_RESOURCES[url.pathname];
    if (protectedResource) {
      return new Response(
        JSON.stringify({
          resource: protectedResource,
          authorization_servers: ['https://api.supadata.ai'],
          scopes_supported: ['mcp'],
          bearer_methods_supported: ['header'],
        }),
        {
          headers: {
            'Content-Type': 'application/json',
            'Access-Control-Allow-Origin': '*',
            'Cache-Control': METADATA_CACHE_CONTROL,
          },
        },
      );
    }

    // This is a plain OAuth 2.0 server, not an OpenID provider: it issues no ID
    // tokens and has no JWKS, so an OIDC discovery document would be invalid.
    // A 404 tells clients to move on to the RFC 8414 document.
    if (url.pathname === '/.well-known/openid-configuration') {
      return new Response(
        JSON.stringify({
          error: 'not_found',
          error_description: 'Not an OpenID provider; see /.well-known/oauth-authorization-server',
        }),
        {
          status: 404,
          headers: {
            'Content-Type': 'application/json',
            'Access-Control-Allow-Origin': '*',
            'Cache-Control': METADATA_CACHE_CONTROL,
          },
        },
      );
    }

    // Log all requests for debugging
    console.log(`[OAuth] ${request.method} ${url.pathname} (auth: ${request.headers.has('authorization') ? 'Bearer' : 'none'})`);

    // Strip the `resource` parameter from authorization and token requests.
    // Clients send whichever resource their discovery found: Claude sends
    // https://api.supadata.ai/ (root metadata), path-aware clients send
    // https://api.supadata.ai/mcp. The provider compares it with RESOURCE
    // exactly and would refuse one or the other with invalid_target. Without
    // it, the provider uses RESOURCE, which is also what every existing grant
    // inherits. Reading the body consumes it, so the provider always gets a
    // rebuilt token request.
    let processedRequest = request;
    let tokenParams: URLSearchParams | null = null;
    if (url.pathname === '/oauth/authorize' && url.searchParams.has('resource')) {
      const authorizeUrl = new URL(url);
      authorizeUrl.searchParams.delete('resource');
      processedRequest = new Request(authorizeUrl, request);
    }
    if (url.pathname === '/oauth/token' && request.method === 'POST') {
      let body = await request.text();
      tokenParams = new URLSearchParams(body);
      if (tokenParams.has('resource')) {
        console.log(`[OAuth] Stripping resource param from token exchange: ${tokenParams.get('resource')}`);
        tokenParams.delete('resource');
        body = tokenParams.toString();
      }
      processedRequest = new Request(request, { body });
    }

    // The provider only answers the root metadata URL
    if (AUTHORIZATION_SERVER_METADATA_PATHS.has(url.pathname)) {
      processedRequest = new Request(
        new URL('/.well-known/oauth-authorization-server', url),
        request,
      );
    }

    // OAuth flow for everything else
    const provider = new OAuthProvider({
      apiRoute: '/mcp',
      apiHandler: mcpHandler,
      defaultHandler: authHandler,
      authorizeEndpoint: '/oauth/authorize',
      tokenEndpoint: '/oauth/token',
      clientRegistrationEndpoint: '/oauth/register',
      scopesSupported: ['mcp'],
      resourceMetadata: { resource: RESOURCE },
      accessTokenTTL: 3600,       // 1 hour
      refreshTokenTTL: REFRESH_TOKEN_IDLE_TTL,
      refreshTokenIdleTTL: REFRESH_TOKEN_IDLE_TTL,
      // 0.1.0 accepted any non-dangerous redirect scheme, and desktop clients
      // registered custom ones (cursor://…). Keep them working; remote http is
      // refused regardless.
      allowPrivateUseRedirectUris: true,
      onError({ code, description, status, headers, internal }) {
        console.log(`[OAuth Error] status=${status} code=${code} desc=${description} reason=${internal?.category}/${internal?.reason}`);
        if (status === 401 && url.pathname.startsWith('/mcp')) {
          return invalidTokenResponse(description, headers);
        }
      },
    });

    let response = await provider.fetch(processedRequest, env, ctx);
    console.log(`[OAuth Response] ${url.pathname} -> ${response.status}`);

    // A request without a token gets a bare challenge without calling onError;
    // answer it like 0.1.0 did, with invalid_token
    if (
      url.pathname.startsWith('/mcp') &&
      response.status === 401 &&
      !response.headers.get('www-authenticate')?.includes('error=')
    ) {
      response = invalidTokenResponse('Missing or invalid access token', response.headers);
    }

    if (tokenParams && response.status >= 400) {
      await logTokenError(env, request, tokenParams, response);
    }

    if (AUTHORIZATION_SERVER_METADATA_PATHS.has(url.pathname) && response.ok) {
      response = withHeaders(response, { 'Cache-Control': METADATA_CACHE_CONTROL, Vary: 'Origin' });
    }

    // The provider echoes the token's audience as `resource`. Clients never get
    // the resource they asked for (it is stripped above), so don't send one
    // that may not match what they asked for; 0.1.0 sent none.
    if (tokenParams && response.ok) {
      const tokens = (await response.json()) as Record<string, unknown>;
      delete tokens.resource;
      response = new Response(JSON.stringify(tokens), response);
    }

    return response;
  },
};
