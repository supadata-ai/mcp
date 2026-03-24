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

// GET /authorize — redirect to dashboard for login
app.get('/authorize', async (c) => {
  const oauthReqInfo = await c.env.OAUTH_PROVIDER.parseAuthRequest(c.req.raw);
  if (!oauthReqInfo.clientId) {
    return c.text('Invalid request: missing client_id', 400);
  }

  const stateToken = await createState(oauthReqInfo, c.env.OAUTH_KV);

  const callbackUrl = new URL('/callback', c.req.url).href;
  const dashboardUrl = new URL('/oauth/mcp', c.env.DASHBOARD_URL);
  dashboardUrl.searchParams.set('state', stateToken);
  dashboardUrl.searchParams.set('callback', callbackUrl);

  return c.redirect(dashboardUrl.toString());
});

// GET /callback — validate JWT from dashboard and complete authorization
app.get('/callback', async (c) => {
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

  return c.redirect(redirectTo);
});

// Wrap Hono app as an ExportedHandler for OAuthProvider compatibility
export const authHandler = {
  fetch: (request: Request, env: any, ctx: any) => app.fetch(request, env, ctx),
};
