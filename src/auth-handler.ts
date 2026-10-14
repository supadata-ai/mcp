import { AuthorizationError, type AuthRequest, type OAuthHelpers } from '@cloudflare/workers-oauth-provider';
import { Hono } from 'hono';
import { jwtVerify } from 'jose';

import { sanitizeClientName } from './client.js';

type Env = {
  OAUTH_PROVIDER: OAuthHelpers;
  OAUTH_KV: KVNamespace;
  DASHBOARD_URL: string;
  MCP_JWT_SECRET: string;
  COOKIE_ENCRYPTION_KEY: string;
};

const app = new Hono<{ Bindings: Env }>();

// The client_name the OAuth client registered with (e.g. "Claude", "Cursor"),
// sanitized for use in a User-Agent. A failed lookup must not block authorization.
async function lookupClientName(
  provider: OAuthHelpers,
  clientId: string
): Promise<string | undefined> {
  try {
    const client = await provider.lookupClient(clientId);
    return sanitizeClientName(client?.clientName);
  } catch (err: any) {
    console.error('[Auth] lookupClient failed:', err?.message);
    return undefined;
  }
}

// Store OAuth request info in KV, keyed by a random state token
async function createState(
  oauthReqInfo: AuthRequest,
  kv: KVNamespace
): Promise<string> {
  const stateToken = crypto.randomUUID();
  await kv.put(
    `oauth_state:${stateToken}`,
    JSON.stringify(oauthReqInfo),
    // 1 hour: a new user may have to sign up and verify their email first
    { expirationTtl: 3600 }
  );
  return stateToken;
}

// parseAuthRequest throws for an unknown client_id or a redirect_uri that isn't
// registered. The redirect_uri can't be trusted then, so answer directly
// (RFC 6749 §4.1.2.1). Errors found after the redirect_uri was validated, such
// as missing PKCE, carry a ready-made `redirectTo` back to the client instead.
async function invalidAuthRequest(
  oauthProvider: OAuthHelpers,
  url: URL,
  err: unknown
): Promise<Response> {
  const message = err instanceof Error ? err.message : String(err);
  const redirectTo = err instanceof AuthorizationError ? err.redirectTo : undefined;
  const clientId = url.searchParams.get('client_id') || '';
  const redirectUri = url.searchParams.get('redirect_uri') || '';
  const client = clientId ? await oauthProvider.lookupClient(clientId).catch(() => null) : null;
  console.warn('[Auth] Invalid authorization request:', JSON.stringify({
    error: message,
    clientId,
    clientName: client?.clientName,
    redirectUri,
    registeredRedirectUris: client?.redirectUris,
    redirected: Boolean(redirectTo),
  }));

  if (redirectTo) {
    return Response.redirect(redirectTo, 302);
  }

  const error = message.startsWith('Invalid client')
    ? 'invalid_client'
    : message.startsWith('Invalid redirect URI')
      ? 'invalid_redirect_uri'
      : 'invalid_request';
  return new Response(JSON.stringify({ error, error_description: message }), {
    status: 400,
    headers: { 'Content-Type': 'application/json' },
  });
}

// GET /oauth/authorize — redirect to dashboard for login
app.get('/oauth/authorize', async (c) => {
  console.log('[Auth] /oauth/authorize hit');
  let oauthReqInfo: AuthRequest;
  try {
    oauthReqInfo = await c.env.OAUTH_PROVIDER.parseAuthRequest(c.req.raw);
  } catch (err) {
    return invalidAuthRequest(c.env.OAUTH_PROVIDER, new URL(c.req.url), err);
  }
  console.log('[Auth] Parsed auth request:', JSON.stringify({ clientId: oauthReqInfo.clientId, redirectUri: oauthReqInfo.redirectUri, scope: oauthReqInfo.scope, resource: oauthReqInfo.resource }));
  if (!oauthReqInfo.clientId) {
    return c.text('Invalid request: missing client_id', 400);
  }

  const stateToken = await createState(oauthReqInfo, c.env.OAUTH_KV);

  const callbackUrl = new URL('/oauth/callback', c.req.url).href;
  const dashboardUrl = new URL('/oauth/mcp', c.env.DASHBOARD_URL);
  dashboardUrl.searchParams.set('state', stateToken);
  dashboardUrl.searchParams.set('callback', callbackUrl);
  // Lets the dashboard attribute the MCP connection to an AI client.
  const clientName = await lookupClientName(c.env.OAUTH_PROVIDER, oauthReqInfo.clientId);
  if (clientName) {
    dashboardUrl.searchParams.set('client', clientName);
  }

  console.log('[Auth] Redirecting to dashboard:', dashboardUrl.toString());
  return c.redirect(dashboardUrl.toString());
});

// GET /oauth/callback — validate JWT from dashboard and complete authorization
app.get('/oauth/callback', async (c) => {
  console.log('[Auth] /oauth/callback hit');
  const token = c.req.query('token');
  const stateToken = c.req.query('state');
  const error = c.req.query('error');

  // Handle deny
  if (error) {
    return c.text(`Authorization denied: ${error}`, 403);
  }

  if (!token || !stateToken) {
    return c.text('Missing token or state parameter', 400);
  }

  // Retrieve and validate the OAuth request info from KV
  const storedState = await c.env.OAUTH_KV.get(`oauth_state:${stateToken}`);
  if (!storedState) {
    return c.text('Invalid or expired state', 400);
  }

  // Delete state to prevent replay
  await c.env.OAUTH_KV.delete(`oauth_state:${stateToken}`);

  let oauthReqInfo: AuthRequest;
  try {
    oauthReqInfo = JSON.parse(storedState);
  } catch {
    return c.text('Corrupted state data', 400);
  }

  // Validate the JWT from the dashboard
  let payload;
  try {
    const secret = new TextEncoder().encode(c.env.MCP_JWT_SECRET);
    const result = await jwtVerify(token, secret);
    payload = result.payload;
  } catch (err: any) {
    console.error('JWT verification failed:', err.message);
    return c.text('Invalid or expired token', 401);
  }

  const userId = payload.sub;
  const apiKey = payload.api_key as string;
  const name = payload.name as string;
  const email = payload.email as string;

  if (!userId || !apiKey) {
    return c.text('Invalid token claims', 400);
  }

  // `resource` is the provider's configured resource: the worker strips the
  // client's own value before parseAuthRequest (see worker.ts)
  console.log('[Auth] JWT valid, userId:', userId, 'resource:', oauthReqInfo.resource);

  const clientName = await lookupClientName(c.env.OAUTH_PROVIDER, oauthReqInfo.clientId);

  // Complete the OAuth authorization — the library issues its own tokens
  const { redirectTo } = await c.env.OAUTH_PROVIDER.completeAuthorization({
    request: oauthReqInfo,
    userId,
    scope: oauthReqInfo.scope || ['mcp'],
    metadata: {
      label: name || email || userId
    },
    props: {
      apiKey,
      userId,
      name,
      email,
      clientName
    }
  });

  console.log('[Auth] completeAuthorization redirectTo:', redirectTo);
  return c.redirect(redirectTo);
});

// Wrap Hono app as an ExportedHandler for OAuthProvider compatibility
export const authHandler = {
  fetch: (request: Request, env: any, ctx: any) => app.fetch(request, env, ctx),
};
