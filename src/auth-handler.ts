import type { AuthRequest, OAuthHelpers } from '@cloudflare/workers-oauth-provider';
import { Hono } from 'hono';
import { jwtVerify } from 'jose';

type Env = {
  OAUTH_PROVIDER: OAuthHelpers;
  OAUTH_KV: KVNamespace;
  DASHBOARD_URL: string;
  MCP_JWT_SECRET: string;
  COOKIE_ENCRYPTION_KEY: string;
};

const app = new Hono<{ Bindings: Env }>();

// Store OAuth request info in KV, keyed by a random state token
async function createState(
  oauthReqInfo: AuthRequest,
  kv: KVNamespace
): Promise<string> {
  const stateToken = crypto.randomUUID();
  await kv.put(
    `oauth_state:${stateToken}`,
    JSON.stringify(oauthReqInfo),
    { expirationTtl: 600 } // 10 minutes
  );
  return stateToken;
}

// GET /oauth/authorize — redirect to dashboard for login
app.get('/oauth/authorize', async (c) => {
  console.log('[Auth] /oauth/authorize hit');
  const oauthReqInfo = await c.env.OAUTH_PROVIDER.parseAuthRequest(c.req.raw);
  console.log('[Auth] Parsed auth request:', JSON.stringify({ clientId: oauthReqInfo.clientId, redirectUri: oauthReqInfo.redirectUri, scope: oauthReqInfo.scope, resource: oauthReqInfo.resource }));
  if (!oauthReqInfo.clientId) {
    return c.text('Invalid request: missing client_id', 400);
  }

  const stateToken = await createState(oauthReqInfo, c.env.OAUTH_KV);

  const callbackUrl = new URL('/oauth/callback', c.req.url).href;
  const dashboardUrl = new URL('/oauth/mcp', c.env.DASHBOARD_URL);
  dashboardUrl.searchParams.set('state', stateToken);
  dashboardUrl.searchParams.set('callback', callbackUrl);

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

  // Remove resource parameter to avoid audience validation issues.
  // Claude sends resource=https://api.supadata.ai/ (trailing slash) but the library
  // validates tokens against protocol://host (no slash) using strict equality.
  // This mismatch causes "Token audience does not match resource server" on every
  // MCP request. Removing resource skips audience validation entirely.
  delete (oauthReqInfo as any).resource;

  console.log('[Auth] JWT valid, userId:', userId, 'resource:', oauthReqInfo.resource);

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
      email
    }
  });

  console.log('[Auth] completeAuthorization redirectTo:', redirectTo);
  return c.redirect(redirectTo);
});

// Wrap Hono app as an ExportedHandler for OAuthProvider compatibility
export const authHandler = {
  fetch: (request: Request, env: any, ctx: any) => app.fetch(request, env, ctx),
};
