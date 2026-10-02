import { describe, expect, jest, test, beforeEach, afterEach } from '@jest/globals';
import { callTool, listTools } from './mcp.js';

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
});
