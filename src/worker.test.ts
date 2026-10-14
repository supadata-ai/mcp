import { describe, expect, jest, test, beforeEach, afterEach } from '@jest/globals';
import { SignJWT } from 'jose';
import { auth, type OAuthClientProvider } from '@modelcontextprotocol/sdk/client/auth.js';
import type {
  OAuthClientInformationMixed,
  OAuthClientMetadata,
  OAuthTokens,
} from '@modelcontextprotocol/sdk/shared/auth.js';
import worker from './worker.js';

const ORIGIN = 'https://api.supadata.ai';
const MCP_URL = `${ORIGIN}/mcp`;
const JWT_SECRET = 'test-mcp-jwt-secret';
// One of the redirect URIs Cursor registers
const REDIRECT_URI = 'http://localhost:33418/callback';

// In-memory stand-in for the OAUTH_KV namespace (expiry is ignored)
function createKv() {
  const store = new Map<string, string>();
  return {
    store,
    async get(key: string, options?: { type?: string } | string) {
      const value = store.get(key);
      if (value === undefined) return null;
      const type = typeof options === 'string' ? options : options?.type;
      return type === 'json' ? JSON.parse(value) : value;
    },
    async put(key: string, value: string) {
      store.set(key, value);
    },
    async delete(key: string) {
      store.delete(key);
    },
    async list({ prefix = '' }: { prefix?: string } = {}) {
      const keys = [...store.keys()].filter((k) => k.startsWith(prefix)).map((name) => ({ name }));
      return { keys, list_complete: true, cursor: '' };
    },
  };
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

async function registerClient(redirectUris = [REDIRECT_URI]) {
  const res = await workerFetch(`${ORIGIN}/oauth/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      client_name: 'Cursor',
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

describe('/mcp without credentials', () => {
  test('returns 401 pointing at the protected resource metadata', async () => {
    const res = await workerFetch(MCP_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{}',
    });
    expect(res.status).toBe(401);
    expect(res.headers.get('www-authenticate')).toContain(
      `resource_metadata="${ORIGIN}/.well-known/oauth-protected-resource"`
    );
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
      return put(key, value);
    };
    const url = new URL(`${ORIGIN}/oauth/authorize`);
    url.searchParams.set('response_type', 'code');
    url.searchParams.set('client_id', client.client_id);
    url.searchParams.set('redirect_uri', REDIRECT_URI);

    const res = await workerFetch(url.toString());
    expect(res.status).toBe(302);
    const state = puts.find((p) => p.key.startsWith('oauth_state:'));
    expect(state?.options).toEqual({ expirationTtl: 3600 });
  });
});

describe('/oauth/token', () => {
  test('exchanges a code when the body has no resource parameter', async () => {
    const client = await registerClient();
    const codeVerifier = 'v'.repeat(64);
    const codeChallenge = Buffer.from(
      await crypto.subtle.digest('SHA-256', new TextEncoder().encode(codeVerifier))
    ).toString('base64url');

    const url = new URL(`${ORIGIN}/oauth/authorize`);
    url.searchParams.set('response_type', 'code');
    url.searchParams.set('client_id', client.client_id);
    url.searchParams.set('redirect_uri', REDIRECT_URI);
    url.searchParams.set('code_challenge', codeChallenge);
    url.searchParams.set('code_challenge_method', 'S256');
    url.searchParams.set('state', 'client-state');
    const redirect = await authorize(url);
    expect(redirect.searchParams.get('state')).toBe('client-state');

    const res = await workerFetch(`${ORIGIN}/oauth/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        code: redirect.searchParams.get('code')!,
        redirect_uri: REDIRECT_URI,
        client_id: client.client_id,
        code_verifier: codeVerifier,
      }).toString(),
    });
    expect(res.status).toBe(200);
    const tokens = (await res.json()) as Record<string, any>;
    expect(tokens.access_token).toBeTruthy();
    expect(tokens.refresh_token).toBeTruthy();
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
