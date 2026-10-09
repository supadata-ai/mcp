import { describe, expect, jest, test, beforeEach, afterEach } from '@jest/globals';
import { readFileSync } from 'node:fs';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { callTool, createMcpServer, listTools, retryConfig } from './mcp.js';
import { VERSION } from './version.js';

const API_KEY = 'test-api-key';

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
      API_KEY
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
  });

  test('supadata_scrape omits optional params when not provided', async () => {
    await callTool('supadata_scrape', { url: 'https://supadata.ai' }, API_KEY);

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

    const result = await callTool('supadata_check_transcript_status', { id: 'job-1' }, API_KEY);
    expect(result.status).toBe('active');
    expect(result._polling.retry_after_seconds).toBe(5);
  });

  test('unknown tool throws', async () => {
    await expect(callTool('nope', {}, API_KEY)).rejects.toThrow('Unknown tool: nope');
  });

  test('unknown tool throws for inherited object keys', async () => {
    await expect(callTool('toString', {}, API_KEY)).rejects.toThrow('Unknown tool: toString');
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
