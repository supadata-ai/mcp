import { describe, expect, jest, test, beforeEach, afterEach } from '@jest/globals';
import { readFileSync } from 'node:fs';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { buildUserAgent, callTool, createMcpServer, listTools, retryConfig } from './mcp.js';
import { detectClient, sanitizeClientName } from './client.js';
import { VERSION } from './version.js';

const API_KEY = 'test-api-key';
const CTX = { apiKey: API_KEY, userAgent: buildUserAgent('test-client', 'hosted') };

describe('mcp tool registry', () => {
  let fetchMock: jest.Mock<any>;
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    fetchMock = jest.fn(async () => ({
      ok: true,
      json: async () => ({ ok: true }),
    })) as any;
    (globalThis as any).fetch = fetchMock;
  });

  afterEach(() => {
    (globalThis as any).fetch = originalFetch;
  });

  test('lists all nine tools', () => {
    expect(listTools().map((t) => t.name).sort()).toEqual(
      [
        'supadata_check_crawl_status',
        'supadata_check_extract_status',
        'supadata_check_transcript_status',
        'supadata_crawl',
        'supadata_extract',
        'supadata_map',
        'supadata_metadata',
        'supadata_scrape',
        'supadata_transcript',
      ].sort()
    );
  });

  test('every tool has a title and read-only/destructive annotations', () => {
    for (const tool of listTools()) {
      expect(tool.title).toBeTruthy();
      expect(tool.annotations.title).toBe(tool.title);
      expect(typeof tool.annotations.readOnlyHint).toBe('boolean');
      expect(typeof tool.annotations.destructiveHint).toBe('boolean');
    }
  });

  test('every tool is read-only and non-destructive', () => {
    for (const tool of listTools()) {
      expect(tool.annotations.readOnlyHint).toBe(true);
      expect(tool.annotations.destructiveHint).toBe(false);
    }
  });

  test('src/version.ts matches package.json', () => {
    const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
    expect(VERSION).toBe(pkg.version);
  });

  test('supadata_scrape forwards noLinks and lang as query params', async () => {
    await callTool(
      'supadata_scrape',
      { url: 'https://supadata.ai', noLinks: true, lang: 'de' },
      CTX
    );

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    const parsed = new URL(url);
    expect(parsed.origin + parsed.pathname).toBe('https://api.supadata.ai/v1/web/scrape');
    expect(parsed.searchParams.get('url')).toBe('https://supadata.ai');
    expect(parsed.searchParams.get('noLinks')).toBe('true');
    expect(parsed.searchParams.get('lang')).toBe('de');
    expect(init.method).toBe('GET');
    expect((init.headers as Record<string, string>)['x-api-key']).toBe(API_KEY);
    expect((init.headers as Record<string, string>)['User-Agent']).toBe(
      `supadata-mcp/${VERSION} (test-client; hosted)`
    );
  });

  test('supadata_scrape omits optional params when not provided', async () => {
    await callTool('supadata_scrape', { url: 'https://supadata.ai' }, CTX);

    const [url] = fetchMock.mock.calls[0] as [string];
    const parsed = new URL(url);
    expect(parsed.searchParams.has('noLinks')).toBe(false);
    expect(parsed.searchParams.has('lang')).toBe(false);
  });

  test('supadata_check_transcript_status adds a polling hint while in progress', async () => {
    fetchMock.mockImplementationOnce(async () => ({
      ok: true,
      json: async () => ({ status: 'active' }),
    }));

    const result = await callTool('supadata_check_transcript_status', { id: 'job-1' }, CTX);
    expect(result.status).toBe('active');
    expect(result._polling.retry_after_seconds).toBe(5);
  });

  test('unknown tool throws', async () => {
    await expect(callTool('nope', {}, CTX)).rejects.toThrow('Unknown tool: nope');
  });

  test('unknown tool throws for inherited object keys', async () => {
    await expect(callTool('toString', {}, CTX)).rejects.toThrow('Unknown tool: toString');
  });
});

describe('CallTool over the MCP protocol', () => {
  let fetchMock: jest.Mock<any>;
  const originalFetch = globalThis.fetch;
  let client: Client;

  beforeEach(async () => {
    retryConfig.baseDelayMs = 0;
    fetchMock = jest.fn() as any;
    (globalThis as any).fetch = fetchMock;

    const { server } = createMcpServer({ supadataApiKey: API_KEY });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    client = new Client({ name: 'test', version: '0.0.0' });
    await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  });

  afterEach(async () => {
    await client.close();
    (globalThis as any).fetch = originalFetch;
  });

  function errorResponse(status: number, body: string) {
    return { ok: false, status, text: async () => body };
  }

  test('returns the API result as text content', async () => {
    fetchMock.mockImplementationOnce(async () => ({ ok: true, json: async () => ({ title: 'x' }) }));

    const result: any = await client.callTool({
      name: 'supadata_metadata',
      arguments: { url: 'https://youtu.be/abc' },
    });

    expect(result.isError).toBeFalsy();
    expect(JSON.parse(result.content[0].text)).toEqual({ title: 'x' });
  });

  test('an API 404 is a tool error result, not a JSON-RPC error', async () => {
    fetchMock.mockImplementationOnce(async () =>
      errorResponse(
        404,
        JSON.stringify({
          error: 'not-found',
          message: 'Not Found',
          details: 'This video does not exist',
          documentationUrl: 'https://docs.supadata.ai/errors/not-found',
        })
      )
    );

    const result: any = await client.callTool({
      name: 'supadata_metadata',
      arguments: { url: 'https://youtu.be/missing' },
    });

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('HTTP 404 not-found');
    expect(result.content[0].text).toContain('This video does not exist');
    expect(result.content[0].text).toContain('https://docs.supadata.ai/errors/not-found');
  });

  function limitExceeded(details: string) {
    return errorResponse(
      429,
      JSON.stringify({ error: 'limit-exceeded', message: 'Limit Exceeded', details })
    );
  }

  test('a per-second rate limit is retried and succeeds', async () => {
    fetchMock
      .mockImplementationOnce(async () => limitExceeded('Request rate limit on current plan was exceeded.'))
      .mockImplementationOnce(async () => ({ ok: true, json: async () => ({ title: 'x' }) }));

    const result: any = await client.callTool({
      name: 'supadata_metadata',
      arguments: { url: 'https://youtu.be/abc' },
    });

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(result.isError).toBeFalsy();
  });

  test('a rate limit that persists after retries tells the model to stop calling in parallel', async () => {
    fetchMock.mockImplementation(async () =>
      limitExceeded('Request rate limit on current plan was exceeded.')
    );

    const result: any = await client.callTool({
      name: 'supadata_check_transcript_status',
      arguments: { id: 'job-1' },
    });

    expect(fetchMock).toHaveBeenCalledTimes(retryConfig.maxRetries + 1);
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('Request rate limit on current plan was exceeded.');
    expect(result.content[0].text).toContain('one at a time, not in parallel');
  });

  test('an exhausted quota is not retried and tells the model to stop', async () => {
    fetchMock.mockImplementation(async () => limitExceeded('Plan usage limit was exceeded.'));

    const result: any = await client.callTool({
      name: 'supadata_transcript',
      arguments: { url: 'https://youtu.be/abc' },
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('monthly credits are used up');
    expect(result.content[0].text).toContain('Do not retry');
    expect(result.content[0].text).not.toContain('wait about 10 seconds');
  });

  test("a target site's 429 on scrape is not retried or called a plan limit", async () => {
    fetchMock.mockImplementation(async () =>
      limitExceeded('The target site is throttling requests (HTTP 429): https://example.com')
    );

    const result: any = await client.callTool({
      name: 'supadata_scrape',
      arguments: { url: 'https://example.com' },
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('The target site is throttling requests');
    expect(result.content[0].text).not.toContain('per-second rate limit');
  });

  test('an invalid URL on a video tool points to supadata_scrape', async () => {
    fetchMock.mockImplementationOnce(async () =>
      errorResponse(
        400,
        JSON.stringify({
          error: 'invalid-request',
          message: 'Invalid Request',
          details: 'The provided URL is incorrect or the video provider could not be detected',
        })
      )
    );

    const result: any = await client.callTool({
      name: 'supadata_metadata',
      arguments: { url: 'https://example.com/blog' },
    });

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('use supadata_scrape instead');
  });

  test('a 404 from scrape says not to guess URLs', async () => {
    fetchMock.mockImplementationOnce(async () =>
      errorResponse(
        404,
        JSON.stringify({ error: 'not-found', message: 'Not Found', details: 'The requested item could not be found' })
      )
    );

    const result: any = await client.callTool({
      name: 'supadata_scrape',
      arguments: { url: 'https://example.com/missing' },
    });

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('use supadata_map');
  });

  test('a non-JSON error body is passed through', async () => {
    fetchMock.mockImplementationOnce(async () => errorResponse(502, 'Bad Gateway'));

    const result: any = await client.callTool({
      name: 'supadata_scrape',
      arguments: { url: 'https://example.com' },
    });

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toBe('Supadata API error (HTTP 502): Bad Gateway');
  });

  test('a network failure is a tool error result', async () => {
    fetchMock.mockImplementationOnce(async () => {
      throw new TypeError('fetch failed');
    });

    const result: any = await client.callTool({
      name: 'supadata_transcript',
      arguments: { url: 'https://youtu.be/abc' },
    });

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toBe('Supadata request failed: fetch failed');
  });

  test('missing required arguments are a tool error and skip the API call', async () => {
    const result: any = await client.callTool({ name: 'supadata_check_transcript_status' });

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toBe(
      'Supadata request failed: Missing required argument "id" for supadata_check_transcript_status'
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });

  test('an unknown tool is still a protocol error', async () => {
    await expect(client.callTool({ name: 'nope', arguments: {} })).rejects.toThrow(/Unknown tool: nope/);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('User-Agent sent to the Supadata API', () => {
  const originalFetch = globalThis.fetch;
  let fetchMock: jest.Mock<any>;

  beforeEach(() => {
    fetchMock = jest.fn(async () => ({ ok: true, json: async () => ({}) })) as any;
    (globalThis as any).fetch = fetchMock;
  });

  afterEach(() => {
    (globalThis as any).fetch = originalFetch;
  });

  async function userAgentFor(config: Parameters<typeof createMcpServer>[0]) {
    const { server } = createMcpServer(config);
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    const client = new Client({ name: 'My Client', version: '0.0.0' });
    await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
    await client.callTool({ name: 'supadata_metadata', arguments: { url: 'https://youtu.be/abc' } });
    await client.close();
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    return (init.headers as Record<string, string>)['User-Agent'];
  }

  test('hosted: uses the detected client', async () => {
    expect(
      await userAgentFor({ supadataApiKey: API_KEY, client: 'Claude-ClaudeAI', transport: 'hosted' })
    ).toBe(`supadata-mcp/${VERSION} (Claude-ClaudeAI; hosted)`);
  });

  test('stdio: falls back to the MCP clientInfo name', async () => {
    expect(await userAgentFor({ supadataApiKey: API_KEY, transport: 'stdio' })).toBe(
      `supadata-mcp/${VERSION} (My-Client; stdio)`
    );
  });

  test('defaults to the stdio transport', async () => {
    expect(await userAgentFor({ supadataApiKey: API_KEY, client: 'Cursor' })).toBe(
      `supadata-mcp/${VERSION} (Cursor; stdio)`
    );
  });
});

describe('detectClient', () => {
  test.each([
    [{ 'x-anthropic-client': 'ClaudeAI', 'user-agent': 'Claude-User' }, 'Claude-ClaudeAI'],
    [{ 'x-anthropic-client': 'ClaudeCode' }, 'Claude-ClaudeCode'],
    [{ 'x-anthropic-client': 'Cowork' }, 'Claude-Cowork'],
    [{ 'user-agent': 'Claude-User' }, 'Claude'],
    [{ 'x-openai-subject': 'abc', 'user-agent': 'python-httpx/0.27' }, 'ChatGPT'],
    [{ 'user-agent': 'openai-mcp/1.0.0' }, 'ChatGPT'],
    [{ 'user-agent': 'codex-mcp-client/0.46.0' }, 'Codex'],
    [{ 'user-agent': 'claude-code/2.0.14 (sdk-cli)' }, 'ClaudeCode-local'],
    [{ 'user-agent': 'Cursor/1.7.0 (darwin arm64)' }, 'Cursor'],
    [{ 'user-agent': 'node-fetch/1.0 (+https://github.com/bitinn/node-fetch)' }, 'node-fetch'],
    [{ 'user-agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)' }, 'Mozilla'],
    [{ 'user-agent': 'node' }, 'node'],
    [{ 'user-agent': '   ' }, 'unknown'],
    [{}, 'unknown'],
  ])('%j -> %s', (headers, expected) => {
    expect(detectClient(new Headers(headers as Record<string, string>))).toBe(expected);
  });
});

describe('sanitizeClientName', () => {
  test.each([
    ['Claude', 'Claude'],
    ['Claude Code (supadata)', 'Claude-Code-supadata'],
    ['my;client)', 'my-client'],
    ['a'.repeat(60), 'a'.repeat(40)],
    ['', undefined],
    ['()', undefined],
    [undefined, undefined],
    [null, undefined],
  ])('%j -> %j', (input, expected) => {
    expect(sanitizeClientName(input)).toBe(expected);
  });
});
