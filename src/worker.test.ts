import { describe, expect, jest, test, beforeEach, afterEach } from '@jest/globals';
import { SignJWT } from 'jose';
import { auth, type OAuthClientProvider } from '@modelcontextprotocol/sdk/client/auth.js';
import type {
  OAuthClientInformationMixed,
  OAuthClientMetadata,
  OAuthTokens,
} from '@modelcontextprotocol/sdk/shared/auth.js';
import { OAuthProvider as OAuthProviderV0 } from 'workers-oauth-provider-v0';
import worker from './worker.js';

const ORIGIN = 'https://api.supadata.ai';
const MCP_URL = `${ORIGIN}/mcp`;
const JWT_SECRET = 'test-mcp-jwt-secret';
// One of the redirect URIs Cursor registers
const REDIRECT_URI = 'http://localhost:33418/callback';

const DAY = 24 * 60 * 60;

type KvPutOptions = { expiration?: number; expirationTtl?: number; metadata?: unknown };

// In-memory stand-in for the OAUTH_KV namespace. Keys expire like KV's do,
// against Date.now(), so tests can move the clock.
function createKv() {
  const store = new Map<string, string>();
  const expirations = new Map<string, number>();
  const metadata = new Map<string, unknown>();
  const live = (key: string) => {
    const expiration = expirations.get(key);
    if (expiration !== undefined && expiration <= Date.now() / 1000) {
      store.delete(key);
      expirations.delete(key);
      metadata.delete(key);
    }
    return store.get(key);
  };
  return {
    store,
    expirations,
    async get(key: string, options?: { type?: string } | string) {
      const value = live(key);
      if (value === undefined) return null;
      const type = typeof options === 'string' ? options : options?.type;
      return type === 'json' ? JSON.parse(value) : value;
    },
    async put(key: string, value: string, options: KvPutOptions = {}) {
      store.set(key, value);
      const expiration =
        options.expiration ??
        (options.expirationTtl !== undefined ? Math.floor(Date.now() / 1000) + options.expirationTtl : undefined);
      if (expiration === undefined) expirations.delete(key);
      else expirations.set(key, expiration);
      if (options.metadata === undefined) metadata.delete(key);
      else metadata.set(key, options.metadata);
    },
    async delete(key: string) {
      store.delete(key);
      expirations.delete(key);
      metadata.delete(key);
    },
    async list({ prefix = '' }: { prefix?: string } = {}) {
      const keys = [...store.keys()]
        .filter((k) => k.startsWith(prefix) && live(k) !== undefined)
        .map((name) => ({ name, expiration: expirations.get(name), metadata: metadata.get(name) }));
      return { keys, list_complete: true, cursor: '' };
    },
  };
}

// Moves Date.now() forward, for the provider, the KV stub and the dashboard JWT
function advanceClock(seconds: number) {
  const now = Date.now();
  jest.spyOn(Date, 'now').mockReturnValue(now + seconds * 1000);
}

let env: Record<string, any>;
let kv: ReturnType<typeof createKv>;

beforeEach(() => {
  // The worker logs every request
  jest.spyOn(console, 'log').mockImplementation(() => {});
  jest.spyOn(console, 'warn').mockImplementation(() => {});
  kv = createKv();
  env = {
    OAUTH_KV: kv,
    DASHBOARD_URL: 'https://dash.supadata.ai',
    MCP_JWT_SECRET: JWT_SECRET,
  };
});

afterEach(() => {
  jest.restoreAllMocks();
});

function workerFetch(input: string | URL | Request, init?: RequestInit): Promise<Response> {
  const request = input instanceof Request ? input : new Request(input, init);
  const ctx = { waitUntil() {}, passThroughOnException() {}, props: undefined };
  return worker.fetch(request, env, ctx);
}

async function registerClient(redirectUris = [REDIRECT_URI], clientName = 'Cursor') {
  const res = await workerFetch(`${ORIGIN}/oauth/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      client_name: clientName,
      redirect_uris: redirectUris,
      token_endpoint_auth_method: 'none',
      grant_types: ['authorization_code', 'refresh_token'],
      response_types: ['code'],
    }),
  });
  expect(res.status).toBe(201);
  return (await res.json()) as Record<string, any>;
}

// Stands in for the dashboard: signs the callback JWT it would mint after login
function dashboardToken() {
  return new SignJWT({ api_key: 'sd_test_key', name: 'Test User', email: 'test@example.com' })
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject('user-1')
    .setIssuedAt()
    .setExpirationTime('5m')
    .sign(new TextEncoder().encode(JWT_SECRET));
}

// GET /oauth/authorize -> dashboard -> GET /oauth/callback; returns the client redirect URL
async function authorize(authorizationUrl: URL | string): Promise<URL> {
  const authorizeRes = await workerFetch(authorizationUrl.toString());
  expect(authorizeRes.status).toBe(302);
  const dashboardUrl = new URL(authorizeRes.headers.get('location')!);
  expect(dashboardUrl.origin + dashboardUrl.pathname).toBe('https://dash.supadata.ai/oauth/mcp');

  const callbackUrl = new URL(dashboardUrl.searchParams.get('callback')!);
  callbackUrl.searchParams.set('state', dashboardUrl.searchParams.get('state')!);
  callbackUrl.searchParams.set('token', await dashboardToken());
  const callbackRes = await workerFetch(callbackUrl.toString());
  expect(callbackRes.status).toBe(302);
  return new URL(callbackRes.headers.get('location')!);
}

describe('discovery metadata', () => {
  test.each([
    ['/.well-known/oauth-protected-resource', ORIGIN],
    ['/.well-known/oauth-protected-resource/mcp', MCP_URL],
  ])('%s returns protected resource metadata', async (path, resource) => {
    const res = await workerFetch(`${ORIGIN}${path}`);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('application/json');
    expect(res.headers.get('cache-control')).toBe('public, max-age=3600');
    expect(await res.json()).toEqual({
      resource,
      authorization_servers: [ORIGIN],
      scopes_supported: ['mcp'],
      bearer_methods_supported: ['header'],
    });
  });

  test.each(['/.well-known/oauth-authorization-server', '/.well-known/oauth-authorization-server/mcp'])(
    '%s returns authorization server metadata',
    async (path) => {
      const res = await workerFetch(`${ORIGIN}${path}`);
      expect(res.status).toBe(200);
      expect(res.headers.get('content-type')).toContain('application/json');
      expect(res.headers.get('cache-control')).toBe('public, max-age=3600');
      const metadata = (await res.json()) as Record<string, any>;
      expect(metadata.issuer).toBe(ORIGIN);
      expect(metadata.authorization_endpoint).toBe(`${ORIGIN}/oauth/authorize`);
      expect(metadata.token_endpoint).toBe(`${ORIGIN}/oauth/token`);
      expect(metadata.registration_endpoint).toBe(`${ORIGIN}/oauth/register`);
      expect(metadata.code_challenge_methods_supported).toContain('S256');
    }
  );

  test('the suffixed authorization server metadata matches the root document', async () => {
    const root = await (await workerFetch(`${ORIGIN}/.well-known/oauth-authorization-server`)).json();
    const suffixed = await (await workerFetch(`${ORIGIN}/.well-known/oauth-authorization-server/mcp`)).json();
    expect(suffixed).toEqual(root);
  });

  test('openid-configuration is a cacheable 404, not a 401', async () => {
    const res = await workerFetch(`${ORIGIN}/.well-known/openid-configuration`);
    expect(res.status).toBe(404);
    expect(res.headers.get('cache-control')).toBe('public, max-age=3600');
  });
});

describe('client registration', () => {
  test('omits the relative registration_client_uri', async () => {
    const client = await registerClient();
    expect(client.client_id).toBeTruthy();
    expect(client.redirect_uris).toEqual([REDIRECT_URI]);
    expect(client).not.toHaveProperty('registration_client_uri');
  });
});

const CODE_VERIFIER = 'v'.repeat(64);

async function codeChallenge(verifier = CODE_VERIFIER) {
  return Buffer.from(
    await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier))
  ).toString('base64url');
}

// An authorization request for a public client, with S256 PKCE
async function authorizationUrl(clientId: string, redirectUri = REDIRECT_URI) {
  const url = new URL(`${ORIGIN}/oauth/authorize`);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('client_id', clientId);
  url.searchParams.set('redirect_uri', redirectUri);
  url.searchParams.set('code_challenge', await codeChallenge());
  url.searchParams.set('code_challenge_method', 'S256');
  return url;
}

function exchangeCode(clientId: string, code: string, redirectUri = REDIRECT_URI) {
  return workerFetch(`${ORIGIN}/oauth/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      redirect_uri: redirectUri,
      client_id: clientId,
      code_verifier: CODE_VERIFIER,
    }).toString(),
  });
}

// Registers a client, authorizes it and exchanges the code for tokens
async function obtainTokens(clientName = 'Cursor') {
  const client = await registerClient([REDIRECT_URI], clientName);
  const redirect = await authorize(await authorizationUrl(client.client_id));
  const res = await exchangeCode(client.client_id, redirect.searchParams.get('code')!);
  expect(res.status).toBe(200);
  return { client, tokens: (await res.json()) as Record<string, any> };
}

// An MCP initialize call with a bearer token
function callMcp(accessToken: string) {
  return workerFetch(MCP_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
      Accept: 'application/json, text/event-stream',
    },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: {
        protocolVersion: '2025-06-18',
        capabilities: {},
        clientInfo: { name: 'test', version: '0.0.0' },
      },
    }),
  });
}

function grantRecords(): Array<Record<string, any>> {
  return [...kv.store.entries()]
    .filter(([key]) => key.startsWith('grant:'))
    .map(([, value]) => JSON.parse(value));
}

function refresh(clientId: string, refreshToken: string) {
  return workerFetch(`${ORIGIN}/oauth/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: refreshToken,
      client_id: clientId,
    }).toString(),
  });
}

// The structured line logTokenError writes
function tokenErrorLogs(): Array<Record<string, any>> {
  return (console.warn as jest.Mock).mock.calls
    .filter(([tag]) => tag === '[OAuth Token Error]')
    .map(([, json]) => JSON.parse(json as string));
}

const INVALID_TOKEN_CHALLENGE = `Bearer realm="OAuth", error="invalid_token"`;

describe('/mcp without credentials', () => {
  test('returns 401 pointing at the protected resource metadata', async () => {
    const res = await workerFetch(MCP_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{}',
    });
    expect(res.status).toBe(401);
    const challenge = res.headers.get('www-authenticate');
    expect(challenge).toContain(INVALID_TOKEN_CHALLENGE);
    expect(challenge).toContain(`resource_metadata="${ORIGIN}/.well-known/oauth-protected-resource"`);
  });

  test('an unknown bearer token gets the same challenge', async () => {
    const res = await workerFetch(MCP_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer user-1:grant-1:nope' },
      body: '{}',
    });
    expect(res.status).toBe(401);
    const challenge = res.headers.get('www-authenticate');
    expect(challenge).toContain(INVALID_TOKEN_CHALLENGE);
    expect(challenge).toContain(`resource_metadata="${ORIGIN}/.well-known/oauth-protected-resource"`);
  });
});

describe('/oauth/authorize', () => {
  test('an unregistered redirect_uri is a 400, not a 500', async () => {
    const client = await registerClient();
    const url = new URL(`${ORIGIN}/oauth/authorize`);
    url.searchParams.set('response_type', 'code');
    url.searchParams.set('client_id', client.client_id);
    url.searchParams.set('redirect_uri', 'https://evil.example/callback');
    url.searchParams.set('code_challenge', 'x'.repeat(43));
    url.searchParams.set('code_challenge_method', 'S256');

    const res = await workerFetch(url.toString());
    expect(res.status).toBe(400);
    expect(res.headers.get('location')).toBeNull();
    expect(await res.json()).toMatchObject({ error: 'invalid_redirect_uri' });
  });

  test('an unknown client_id is a 400, not a 500', async () => {
    const url = new URL(`${ORIGIN}/oauth/authorize`);
    url.searchParams.set('response_type', 'code');
    url.searchParams.set('client_id', 'does-not-exist');
    url.searchParams.set('redirect_uri', REDIRECT_URI);

    const res = await workerFetch(url.toString());
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: 'invalid_client' });
  });

  test('stores the pending request for an hour', async () => {
    const client = await registerClient();
    const puts: Array<{ key: string; options: any }> = [];
    const put = kv.put.bind(kv);
    kv.put = async (key: string, value: string, options?: any) => {
      puts.push({ key, options });
      return put(key, value, options);
    };

    const res = await workerFetch((await authorizationUrl(client.client_id)).toString());
    expect(res.status).toBe(302);
    const state = puts.find((p) => p.key.startsWith('oauth_state:'));
    expect(state?.options).toEqual({ expirationTtl: 3600 });
  });
});

describe('/oauth/token', () => {
  test('exchanges a code when the body has no resource parameter', async () => {
    const client = await registerClient();
    const url = await authorizationUrl(client.client_id);
    url.searchParams.set('state', 'client-state');
    const redirect = await authorize(url);
    expect(redirect.searchParams.get('state')).toBe('client-state');

    const res = await exchangeCode(client.client_id, redirect.searchParams.get('code')!);
    expect(res.status).toBe(200);
    const tokens = (await res.json()) as Record<string, any>;
    expect(tokens.access_token).toBeTruthy();
    expect(tokens.refresh_token).toBeTruthy();
    // 0.1.0 sent no `resource`; the provider's audience isn't echoed either
    expect(tokens).not.toHaveProperty('resource');
  });

  test.each([`${ORIGIN}/`, MCP_URL])('a %s resource indicator is accepted at authorize and token', async (resource) => {
    const client = await registerClient();
    const url = await authorizationUrl(client.client_id);
    url.searchParams.set('resource', resource);
    const redirect = await authorize(url);

    const res = await workerFetch(`${ORIGIN}/oauth/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        code: redirect.searchParams.get('code')!,
        redirect_uri: REDIRECT_URI,
        client_id: client.client_id,
        code_verifier: CODE_VERIFIER,
        resource,
      }).toString(),
    });
    expect(res.status).toBe(200);
    const tokens = (await res.json()) as Record<string, any>;
    expect((await callMcp(tokens.access_token)).status).toBe(200);
  });

  test('a public client without PKCE is sent back to its redirect_uri with an error', async () => {
    const client = await registerClient();
    const url = await authorizationUrl(client.client_id);
    url.searchParams.delete('code_challenge');
    url.searchParams.delete('code_challenge_method');
    url.searchParams.set('state', 'client-state');

    const res = await workerFetch(url.toString());
    expect(res.status).toBe(302);
    const location = new URL(res.headers.get('location')!);
    expect(location.origin + location.pathname).toBe(REDIRECT_URI);
    expect(location.searchParams.get('error')).toBe('invalid_request');
    expect(location.searchParams.get('state')).toBe('client-state');
  });
});

describe('refresh tokens', () => {
  test('a new grant expires after 30 idle days', async () => {
    await obtainTokens();
    const [grant] = grantRecords();
    expect(grant.expiresAt - grant.createdAt).toBeGreaterThanOrEqual(30 * DAY);
    expect(grant.expiresAt - grant.createdAt).toBeLessThan(30 * DAY + 60);
    expect(grant.resource).toBe(ORIGIN);
  });

  test('refreshing moves the expiry 30 days ahead, past the first 30 days', async () => {
    const { client, tokens } = await obtainTokens('Claude');
    let refreshToken = tokens.refresh_token;

    // Used every 20 days for 100 days
    for (let day = 20; day <= 100; day += 20) {
      advanceClock(20 * DAY);
      const res = await refresh(client.client_id, refreshToken);
      expect(res.status).toBe(200);
      const rotated = (await res.json()) as Record<string, any>;
      refreshToken = rotated.refresh_token;

      const now = Math.floor(Date.now() / 1000);
      const [grant] = grantRecords();
      expect(grant.expiresAt - now).toBeGreaterThanOrEqual(30 * DAY - 1);
      expect(grant.expiresAt - now).toBeLessThanOrEqual(30 * DAY);
      // KV keeps the record exactly as long
      expect(kv.expirations.get(`grant:user-1:${grant.id}`)).toBe(grant.expiresAt);
      expect((await callMcp(rotated.access_token)).status).toBe(200);
    }
  });

  test('a grant idle for more than 30 days expires', async () => {
    const { client, tokens } = await obtainTokens('Codex');
    advanceClock(10 * DAY);
    const first = await refresh(client.client_id, tokens.refresh_token);
    expect(first.status).toBe(200);
    const { refresh_token: refreshToken } = (await first.json()) as Record<string, any>;

    // 29 days after the last refresh it still works; 31 days after, it doesn't
    advanceClock(29 * DAY);
    expect(grantRecords()).toHaveLength(1);
    advanceClock(2 * DAY);
    const res = await refresh(client.client_id, refreshToken);
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: 'invalid_grant', error_description: 'Grant not found' });
  });

  test('rotation accepts the previous token, and rejects the one it replaced', async () => {
    const { client, tokens } = await obtainTokens('Codex');

    const first = await refresh(client.client_id, tokens.refresh_token);
    expect(first.status).toBe(200);
    const rotated = (await first.json()) as Record<string, any>;
    expect(rotated.refresh_token).not.toBe(tokens.refresh_token);

    // A second process still holding the old token gets through once more...
    const raced = await refresh(client.client_id, tokens.refresh_token);
    expect(raced.status).toBe(200);

    // ...which rotates the grant again, so the first process's token is now stale
    const stale = await refresh(client.client_id, rotated.refresh_token);
    expect(stale.status).toBe(400);
    expect(await stale.json()).toEqual({ error: 'invalid_grant', error_description: 'Invalid refresh token' });

    const [log] = tokenErrorLogs();
    expect(log).toMatchObject({
      status: 400,
      error: 'invalid_grant',
      description: 'Invalid refresh token',
      grantType: 'refresh_token',
      clientId: client.client_id,
      clientName: 'Codex',
      grantExists: true,
      grantRefreshed: true,
    });
    expect(log.grantAgeDays).toBe(0);
    expect(log.grantExpiresInDays).toBeCloseTo(30, 0);
  });

  test('an expired grant is an invalid_grant 400, logged as missing', async () => {
    const { client, tokens } = await obtainTokens('Codex');
    // KV drops the grant when it expires
    for (const key of [...kv.store.keys()].filter((k) => k.startsWith('grant:'))) kv.store.delete(key);

    const res = await refresh(client.client_id, tokens.refresh_token);
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: 'invalid_grant', error_description: 'Grant not found' });

    const logs = tokenErrorLogs();
    expect(logs).toHaveLength(1);
    expect(logs[0]).toMatchObject({
      error: 'invalid_grant',
      description: 'Grant not found',
      grantType: 'refresh_token',
      clientName: 'Codex',
      clientAgeDays: 0,
      grantExists: false,
      grantAgeDays: null,
    });
    // Nothing secret reaches the log
    const line = (console.warn as jest.Mock).mock.calls.flat().join(' ');
    expect(line).not.toContain(tokens.refresh_token.split(':')[2]);
    expect(line).not.toContain(tokens.refresh_token.split(':')[0]);
  });

  test('an access token from an expired grant gets an invalid_token challenge on /mcp', async () => {
    const { tokens } = await obtainTokens();
    for (const key of [...kv.store.keys()].filter((k) => k.startsWith('token:'))) kv.store.delete(key);

    const res = await workerFetch(MCP_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tokens.access_token}` },
      body: '{}',
    });
    expect(res.status).toBe(401);
    expect(res.headers.get('www-authenticate')).toContain(INVALID_TOKEN_CHALLENGE);
    expect(res.headers.get('www-authenticate')).toContain('resource_metadata=');
  });

  test('a client authentication 401 from /oauth/token keeps the provider challenge', async () => {
    const res = await workerFetch(`${ORIGIN}/oauth/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ grant_type: 'refresh_token', refresh_token: 'a:b:c', client_id: 'nope' }).toString(),
    });
    expect(res.status).toBe(401);
    expect(res.headers.get('www-authenticate') ?? '').not.toContain('resource_metadata');
    expect(tokenErrorLogs()[0]).toMatchObject({ clientId: 'nope', clientName: null, grantExists: false });
  });
});

describe('grants, tokens and clients written by 0.1.0', () => {
  const CURSOR_SCHEME_REDIRECT = 'cursor://anysphere.cursor-mcp/oauth/callback';

  // The provider as deployed before the upgrade (0.1.0, 30-day grants, `resource`
  // stripped), writing to the same KV
  function legacyFetch(input: string | URL, init?: RequestInit): Promise<Response> {
    const provider = new OAuthProviderV0({
      apiRoute: '/mcp',
      apiHandler: { fetch: async () => new Response('legacy') } as any,
      defaultHandler: {
        async fetch(request: Request, legacyEnv: any) {
          const oauthReqInfo = await legacyEnv.OAUTH_PROVIDER.parseAuthRequest(request);
          delete oauthReqInfo.resource;
          const { redirectTo } = await legacyEnv.OAUTH_PROVIDER.completeAuthorization({
            request: oauthReqInfo,
            userId: 'user-1',
            scope: ['mcp'],
            metadata: { label: 'Test User' },
            props: { apiKey: 'sd_test_key', userId: 'user-1', name: 'Test User', email: 'test@example.com' },
          });
          return new Response(null, { status: 302, headers: { Location: redirectTo } });
        },
      } as any,
      authorizeEndpoint: '/oauth/authorize',
      tokenEndpoint: '/oauth/token',
      clientRegistrationEndpoint: '/oauth/register',
      scopesSupported: ['mcp'],
      accessTokenTTL: 3600,
      refreshTokenTTL: 30 * DAY,
    });
    const ctx = { waitUntil() {}, passThroughOnException() {} };
    // Its own env: 0.1.0 caches its helpers on env.OAUTH_PROVIDER
    return provider.fetch(new Request(input, init), { OAUTH_KV: kv } as any, ctx as any);
  }

  // A Cursor-like client connects and refreshes once, all under 0.1.0
  async function legacySession() {
    const registration = await legacyFetch(`${ORIGIN}/oauth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        client_name: 'Cursor',
        redirect_uris: [CURSOR_SCHEME_REDIRECT, REDIRECT_URI],
        token_endpoint_auth_method: 'none',
        grant_types: ['authorization_code', 'refresh_token'],
        response_types: ['code'],
      }),
    });
    expect(registration.status).toBe(201);
    const { client_id: clientId } = (await registration.json()) as Record<string, any>;

    const url = await authorizationUrl(clientId);
    url.searchParams.set('resource', MCP_URL);
    const authorizeRes = await legacyFetch(url);
    expect(authorizeRes.status).toBe(302);
    const code = new URL(authorizeRes.headers.get('location')!).searchParams.get('code')!;

    const tokenRequest = (body: Record<string, string>) =>
      legacyFetch(`${ORIGIN}/oauth/token`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ client_id: clientId, ...body }).toString(),
      });
    const exchanged = await tokenRequest({
      grant_type: 'authorization_code',
      code,
      redirect_uri: REDIRECT_URI,
      code_verifier: CODE_VERIFIER,
    });
    expect(exchanged.status).toBe(200);
    const first = (await exchanged.json()) as Record<string, any>;

    advanceClock(5 * DAY);
    const refreshed = await tokenRequest({ grant_type: 'refresh_token', refresh_token: first.refresh_token });
    expect(refreshed.status).toBe(200);
    return { clientId, tokens: (await refreshed.json()) as Record<string, any> };
  }

  test('0.1.0 records have no resource and no key metadata', async () => {
    const { clientId } = await legacySession();
    const [grant] = grantRecords();
    expect(grant).not.toHaveProperty('resource');
    expect(grant.previousRefreshTokenId).toBeTruthy();
    expect(grant.expiresAt - grant.createdAt).toBe(30 * DAY);
    const { keys } = await kv.list({ prefix: 'grant:' });
    expect(keys[0].metadata).toBeUndefined();
    const client = JSON.parse(kv.store.get(`client:${clientId}`)!);
    expect(client.redirectUris).toEqual([CURSOR_SCHEME_REDIRECT, REDIRECT_URI]);
    expect(client).not.toHaveProperty('registrationExpiresAt');
    const [token] = [...kv.store.entries()].filter(([key]) => key.startsWith('token:')).map(([, v]) => JSON.parse(v));
    expect(token.audience).toBeUndefined();
  });

  test('an access token issued by 0.1.0 still calls /mcp', async () => {
    const { tokens } = await legacySession();
    expect((await callMcp(tokens.access_token)).status).toBe(200);
  });

  test('a 0.1.0 grant refreshes, is bound to the resource and starts sliding', async () => {
    const { clientId, tokens } = await legacySession();
    const [before] = grantRecords();

    // 28 days into a 30-day grant that 0.1.0 never extended
    advanceClock(23 * DAY);
    const res = await refresh(clientId, tokens.refresh_token);
    expect(res.status).toBe(200);
    const refreshed = (await res.json()) as Record<string, any>;
    expect(refreshed).not.toHaveProperty('resource');
    expect((await callMcp(refreshed.access_token)).status).toBe(200);

    const now = Math.floor(Date.now() / 1000);
    const [after] = grantRecords();
    expect(after.id).toBe(before.id);
    expect(after.createdAt).toBe(before.createdAt);
    expect(after.resource).toBe(ORIGIN);
    expect(after.expiresAt).toBe(now + 30 * DAY);
    expect(after.expiresAt).toBeGreaterThan(before.expiresAt);

    // and keeps going past the 30 days 0.1.0 gave it
    advanceClock(20 * DAY);
    const again = await refresh(clientId, refreshed.refresh_token);
    expect(again.status).toBe(200);
    expect((await callMcp(((await again.json()) as Record<string, any>).access_token)).status).toBe(200);
  });

  test('a 0.1.0 client authorizes again, on a loopback or a cursor:// redirect', async () => {
    const { clientId } = await legacySession();

    for (const redirectUri of [REDIRECT_URI, CURSOR_SCHEME_REDIRECT]) {
      const redirect = await authorize(await authorizationUrl(clientId, redirectUri));
      expect(redirect.href.startsWith(redirectUri)).toBe(true);
      const res = await exchangeCode(clientId, redirect.searchParams.get('code')!, redirectUri);
      expect(res.status).toBe(200);
      const tokens = (await res.json()) as Record<string, any>;
      expect((await callMcp(tokens.access_token)).status).toBe(200);
    }
    // Each authorization replaced the user's earlier grant for this client,
    // the unbound 0.1.0 one included
    expect(grantRecords()).toHaveLength(1);
  });
});

describe('MCP SDK client OAuth round trip', () => {
  // A public client registered by dynamic client registration, like Cursor
  class InMemoryOAuthProvider implements OAuthClientProvider {
    client?: OAuthClientInformationMixed;
    savedTokens?: OAuthTokens;
    verifier?: string;
    authorizationUrl?: URL;

    get redirectUrl() {
      return REDIRECT_URI;
    }
    get clientMetadata(): OAuthClientMetadata {
      return {
        client_name: 'Cursor',
        redirect_uris: [REDIRECT_URI],
        token_endpoint_auth_method: 'none',
        grant_types: ['authorization_code', 'refresh_token'],
        response_types: ['code'],
      };
    }
    clientInformation() {
      return this.client;
    }
    saveClientInformation(info: OAuthClientInformationMixed) {
      this.client = info;
    }
    tokens() {
      return this.savedTokens;
    }
    saveTokens(tokens: OAuthTokens) {
      this.savedTokens = tokens;
    }
    redirectToAuthorization(url: URL) {
      this.authorizationUrl = url;
    }
    saveCodeVerifier(verifier: string) {
      this.verifier = verifier;
    }
    codeVerifier() {
      return this.verifier!;
    }
  }

  test('discovers, registers, authorizes, exchanges and calls /mcp', async () => {
    const requested: string[] = [];
    const fetchFn = (input: string | URL, init?: RequestInit) => {
      requested.push(new URL(input).pathname);
      return workerFetch(input, init);
    };
    const provider = new InMemoryOAuthProvider();

    expect(await auth(provider, { serverUrl: MCP_URL, fetchFn })).toBe('REDIRECT');
    // Path-aware discovery is answered on the first try
    expect(requested[0]).toBe('/.well-known/oauth-protected-resource/mcp');
    expect(requested).toContain('/oauth/register');
    expect(provider.authorizationUrl!.searchParams.get('resource')).toBe(MCP_URL);

    const redirect = await authorize(provider.authorizationUrl!);
    expect(redirect.origin + redirect.pathname).toBe(REDIRECT_URI);
    const code = redirect.searchParams.get('code')!;

    expect(await auth(provider, { serverUrl: MCP_URL, authorizationCode: code, fetchFn })).toBe(
      'AUTHORIZED'
    );
    expect(provider.savedTokens?.access_token).toBeTruthy();

    const res = await workerFetch(MCP_URL, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${provider.savedTokens!.access_token}`,
        'Content-Type': 'application/json',
        Accept: 'application/json, text/event-stream',
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'initialize',
        params: {
          protocolVersion: '2025-06-18',
          capabilities: {},
          clientInfo: { name: 'cursor-test', version: '0.0.0' },
        },
      }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, any>;
    expect(body.result.serverInfo).toBeDefined();
  });
});
