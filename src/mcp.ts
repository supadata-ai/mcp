import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import {
  ListToolsRequestSchema,
  CallToolRequestSchema,
  ErrorCode,
  McpError,
} from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';

import { VERSION } from './version.js';

// A non-2xx response from the Supadata API. Carries the HTTP status and the API's
// `{ error, message, details, documentationUrl }` body (when it parses) so the
// failure can be reported to the model as a readable tool result.
export class SupadataApiError extends Error {
  status: number;
  body: any;

  constructor(status: number, body: any, rawText: string) {
    super(rawText);
    this.name = 'SupadataApiError';
    this.status = status;
    this.body = body;
  }
}

async function callSupadata(path: string, args: any, apiKey: string, method: 'GET' | 'POST' = 'GET') {
  console.log(`[MCP] Calling Supadata: ${method} ${path}, Key length: ${apiKey?.length ?? 0}`);

  let url = `https://api.supadata.ai/v1${path}`;
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'x-api-key': apiKey,
  };

  let body = undefined;

  if (method === 'GET' && args) {
    const params = new URLSearchParams();
    Object.entries(args).forEach(([key, value]) => {
      if (value !== undefined && value !== null) {
        params.append(key, String(value));
      }
    });
    const queryString = params.toString();
    if (queryString) {
      url += `?${queryString}`;
    }
  } else if (method === 'POST') {
    body = JSON.stringify(args);
  }

  for (let attempt = 0; ; attempt++) {
    const res = await fetch(url, {
      method,
      headers,
      body,
    });

    if (res.ok) {
      return res.json();
    }

    const errorText = redactApiKeys(await res.text());
    console.error(`Supadata API Error (${res.status}): ${errorText}`);
    let errorBody: any = null;
    try {
      errorBody = JSON.parse(errorText);
    } catch {
      // Non-JSON error body (e.g. an HTML error page) — keep the raw text.
    }
    const err = new SupadataApiError(res.status, errorBody, errorText);

    // Per-second rate limits clear quickly, so retry those here instead of
    // handing the failure to the model. Quota exhaustion is not retried.
    if (isRateLimit(err) && attempt < retryConfig.maxRetries) {
      await sleep(retryDelayMs(res, attempt));
      continue;
    }
    throw err;
  }
}

export const retryConfig = { maxRetries: 2, baseDelayMs: 1000, maxDelayMs: 5000 };

function retryDelayMs(res: { headers?: Headers }, attempt: number) {
  const retryAfter = Number(res.headers?.get?.('retry-after'));
  const delay = retryAfter > 0
    ? retryAfter * 1000
    : retryConfig.baseDelayMs * 2 ** attempt * (1 + Math.random() * 0.5);
  return Math.min(delay, retryConfig.maxDelayMs);
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// The API echoes invalid keys back in its error message; keep them out of logs
// and tool results.
function redactApiKeys(text: string) {
  return text.replace(/\bsd_[A-Za-z0-9]+/g, 'sd_[redacted]');
}

function errorDetails(err: SupadataApiError) {
  return `${err.body?.details ?? ''} ${err.body?.message ?? ''}`;
}

// The API returns 429 limit-exceeded both for per-second rate limits and for an
// exhausted monthly quota; `details` tells them apart.
function isRateLimit(err: SupadataApiError) {
  return err.status === 429 && /rate limit/i.test(errorDetails(err));
}

function isQuotaExhausted(err: SupadataApiError) {
  return err.status === 429 && /usage limit/i.test(errorDetails(err));
}

const TERMINAL_STATUSES = ['completed', 'failed', 'cancelled'];

function addPollingHint(
  result: any,
  toolName: string,
  id: string,
  inProgressStatuses?: string[],
) {
  const status = result?.status;
  if (!status) return result;

  const isTerminal = inProgressStatuses
    ? !inProgressStatuses.includes(status)
    : TERMINAL_STATUSES.includes(status);

  if (!isTerminal) {
    return {
      ...result,
      _polling: {
        message: `Job is still processing (status: "${status}"). Call ${toolName} again with id "${id}" to check progress.`,
        retry_after_seconds: 5,
      },
    };
  }

  return result;
}

const toolRegistry = {
  supadata_transcript: {
    schema: {
      name: 'supadata_transcript',
      title: 'Get Video Transcript',
      description: 'Get the transcript (what is said) of a video or post on YouTube, TikTok, Instagram, X (Twitter) or Facebook, or of an audio or video file URL. Not for ordinary web pages: use supadata_scrape for those. For large files, returns a jobId instead of the transcript directly - use supadata_check_transcript_status with that jobId to poll for results.',
      annotations: {
        title: 'Get Video Transcript',
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
      inputSchema: {
        type: 'object',
        properties: {
          url: {
            type: 'string',
            description: 'URL of a single video or post on YouTube, TikTok, Instagram, X (Twitter) or Facebook, or a direct link to an audio or video file. Not for ordinary web pages (use supadata_scrape).',
          },
          lang: {
            type: 'string',
            description: 'Preferred transcript language as an ISO 639-1 code, e.g. "en". Falls back to the first available language.',
          },
          text: {
            type: 'boolean',
            description: 'true returns the transcript as plain text; false (default) returns timestamped segments.',
          },
          chunkSize: {
            type: 'number',
            minimum: 50,
            description: 'Maximum characters per timestamped segment (at least 50). Ignored when text is true.',
          },
          mode: {
            type: 'string',
            enum: ['native', 'auto', 'generate'],
            description: '"native" only fetches an existing transcript, "generate" always transcribes with AI, "auto" (default) tries native first and falls back to generate.',
          },
        },
        required: ['url'],
      },
    },
    handler: (args: any, apiKey: string) =>
      callSupadata('/transcript', args, apiKey, 'GET'),
  },

  supadata_check_transcript_status: {
    schema: {
      name: 'supadata_check_transcript_status',
      title: 'Check Transcript Job Status',
      description: 'Check transcript job status and retrieve results. Returns status: "queued", "active", "completed", or "failed". If status is not "completed" or "failed", call this tool again after a few seconds with the same id.',
      annotations: {
        title: 'Check Transcript Job Status',
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
      inputSchema: {
        type: 'object',
        properties: {
          id: {
            type: 'string',
            description: 'The job id returned by supadata_transcript.',
          },
        },
        required: ['id'],
      },
    },
    handler: async (args: any, apiKey: string) => {
      const id = args.id;
      const result = await callSupadata(`/transcript/${id}`, {}, apiKey, 'GET');
      return addPollingHint(result, 'supadata_check_transcript_status', id);
    },
  },

  supadata_scrape: {
    schema: {
      name: 'supadata_scrape',
      title: 'Scrape Web Page',
      description: 'Fetch a single web page and return its main content as Markdown, along with the page title, description and the links it contains. Use this to read or summarize a specific URL. To find which pages exist on a site, use supadata_map; to fetch many pages at once, use supadata_crawl. Costs 1 credit.',
      annotations: {
        title: 'Scrape Web Page',
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
      inputSchema: {
        type: 'object',
        properties: {
          url: {
            type: 'string',
            description: 'Full URL of the web page, including https://. Use a URL you know exists; to find pages on a site, use supadata_map.',
          },
          noLinks: {
            type: 'boolean',
            description: 'true leaves out the list of links found on the page.',
          },
          lang: {
            type: 'string',
            description: 'Preferred page language as an ISO 639-1 code, e.g. "en", for sites that serve several languages.',
          },
        },
        required: ['url'],
      },
    },
    handler: (args: any, apiKey: string) =>
      callSupadata('/web/scrape', args, apiKey, 'GET'),
  },

  supadata_map: {
    schema: {
      name: 'supadata_map',
      title: 'Map Website URLs',
      description: 'List the URLs found on a website without fetching their content. Use this to discover a site\'s pages before choosing which ones to read with supadata_scrape, or to check a site\'s size before starting a supadata_crawl. Costs 1 credit.',
      annotations: {
        title: 'Map Website URLs',
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
      inputSchema: {
        type: 'object',
        properties: {
          url: {
            type: 'string',
            description: 'Full URL of the website to map, including https://.',
          },
        },
        required: ['url'],
      },
    },
    handler: (args: any, apiKey: string) =>
      callSupadata('/web/map', args, apiKey, 'GET'),
  },

  supadata_crawl: {
    schema: {
      name: 'supadata_crawl',
      title: 'Start Website Crawl',
      description: 'Create a crawl job to extract content from all pages on a website. Not available on every Supadata plan; if it returns upgrade-required, tell the user rather than retrying. Returns a jobId - use supadata_check_crawl_status with that jobId to poll for results.',
      annotations: {
        title: 'Start Website Crawl',
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: true,
      },
      inputSchema: {
        type: 'object',
        properties: {
          url: {
            type: 'string',
            description: 'Full URL to start crawling from, including https://.',
          },
          limit: {
            type: 'number',
            minimum: 1,
            maximum: 5000,
            description: 'Maximum number of pages to crawl (1-5000, default 100). Each page costs 1 credit.',
          },
        },
        required: ['url'],
      },
    },
    handler: (args: any, apiKey: string) =>
      callSupadata('/web/crawl', args, apiKey, 'POST'),
  },

  supadata_check_crawl_status: {
    schema: {
      name: 'supadata_check_crawl_status',
      title: 'Check Crawl Job Status',
      description: 'Check crawl job status and retrieve results. Returns status: "scraping", "completed", "failed", or "cancelled". If status is "scraping", call this tool again after a few seconds with the same id.',
      annotations: {
        title: 'Check Crawl Job Status',
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
      inputSchema: {
        type: 'object',
        properties: {
          id: {
            type: 'string',
            description: 'The job id returned by supadata_crawl.',
          },
        },
        required: ['id'],
      },
    },
    handler: async (args: any, apiKey: string) => {
      const id = args.id;
      const result = await callSupadata(`/web/crawl/${id}`, {}, apiKey, 'GET');
      return addPollingHint(result, 'supadata_check_crawl_status', id, ['scraping']);
    },
  },

  supadata_metadata: {
    schema: {
      name: 'supadata_metadata',
      title: 'Get Media Metadata',
      description: 'Fetch metadata from a media URL (YouTube, TikTok, Instagram, Twitter/X, Facebook). Returns platform info, title, description, author details, engagement stats, media details, tags, and creation date. Use this for details about a video or post; use supadata_transcript for what is said in it.',
      annotations: {
        title: 'Get Media Metadata',
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
      inputSchema: {
        type: 'object',
        properties: {
          url: {
            type: 'string',
            description: 'URL of a single video or post on YouTube, TikTok, Instagram, X (Twitter) or Facebook.',
          },
        },
        required: ['url'],
      },
    },
    handler: (args: any, apiKey: string) =>
      callSupadata('/metadata', args, apiKey, 'GET'),
  },

  supadata_extract: {
    schema: {
      name: 'supadata_extract',
      title: 'Extract Structured Data from Video',
      description: 'Extract structured data from a video URL using AI. Provide a prompt for what to extract, a JSON Schema for the output format, or both. Returns a jobId for async processing - use supadata_check_extract_status with that jobId to poll for results.',
      annotations: {
        title: 'Extract Structured Data from Video',
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: true,
      },
      inputSchema: {
        type: 'object',
        properties: {
          url: {
            type: 'string',
            description: 'URL of a single video or post on YouTube, TikTok, Instagram, X (Twitter) or Facebook.',
          },
          prompt: {
            type: 'string',
            description: 'What to extract from the video, in plain language.',
          },
          schema: {
            type: 'object',
            description: 'JSON Schema describing the output format. Provide this, prompt, or both.',
          },
        },
        required: ['url'],
      },
    },
    handler: (args: any, apiKey: string) =>
      callSupadata('/extract', args, apiKey, 'POST'),
  },

  supadata_check_extract_status: {
    schema: {
      name: 'supadata_check_extract_status',
      title: 'Check Extract Job Status',
      description: 'Check extract job status and retrieve results. Returns status: "queued", "active", "completed", or "failed". If status is not "completed" or "failed", call this tool again after a few seconds with the same id.',
      annotations: {
        title: 'Check Extract Job Status',
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
      inputSchema: {
        type: 'object',
        properties: {
          id: {
            type: 'string',
            description: 'The job id returned by supadata_extract.',
          },
        },
        required: ['id'],
      },
    },
    handler: async (args: any, apiKey: string) => {
      const id = args.id;
      const result = await callSupadata(`/extract/${id}`, {}, apiKey, 'GET');
      return addPollingHint(result, 'supadata_check_extract_status', id);
    },
  },
};

export function listTools() {
  return Object.values(toolRegistry).map((t) => t.schema);
}

export async function callTool(
  name: string,
  args: any,
  apiKey: string
) {
  const tool = (toolRegistry as any)[name];
  if (!Object.prototype.hasOwnProperty.call(toolRegistry, name)) {
    throw new Error(`Unknown tool: ${name}`);
  }
  for (const field of tool.schema.inputSchema.required) {
    if (args?.[field] === undefined || args?.[field] === null || args?.[field] === '') {
      throw new Error(`Missing required argument "${field}" for ${name}`);
    }
  }
  return tool.handler(args, apiKey);
}

/**
 * Turn a failed tool call into a tool result with `isError: true`.
 *
 * MCP distinguishes protocol errors (malformed request, unknown tool) from tool
 * execution errors. Throwing from a CallTool handler on the low-level `Server`
 * produces a JSON-RPC error, which clients count as a failed request and the
 * model cannot read. API failures (video not found, quota exceeded, rate limited)
 * are tool execution errors: return them as content so the model can react.
 */
export function toolErrorResult(err: unknown, toolName?: string) {
  let text: string;

  if (err instanceof SupadataApiError) {
    const body = err.body;
    const code = body?.error ? ` ${body.error}` : '';
    const parts = [body?.message, body?.details].filter(Boolean);
    const summary = parts.length ? parts.join(': ') : err.message || 'Request failed';
    text = `Supadata API error (HTTP ${err.status}${code}): ${summary}`;
    const hint = errorHint(err, toolName);
    if (hint) {
      text += `\n${hint}`;
    }
    if (body?.documentationUrl) {
      text += `\nDocumentation: ${body.documentationUrl}`;
    }
  } else {
    const message = err instanceof Error ? err.message : String(err);
    text = `Supadata request failed: ${message}`;
  }

  return {
    content: [{ type: 'text' as const, text }],
    isError: true,
  };
}

const VIDEO_TOOLS = ['supadata_transcript', 'supadata_metadata', 'supadata_extract'];
const STATUS_TOOLS = [
  'supadata_check_transcript_status',
  'supadata_check_crawl_status',
  'supadata_check_extract_status',
];

// Tell the model whether retrying can help, so agents working through a list of
// URLs stop on terminal errors instead of repeating them.
function errorHint(err: SupadataApiError, toolName?: string): string | undefined {
  if (isQuotaExhausted(err)) {
    return (
      "The Supadata account's monthly credits are used up. Do not retry, and do not call " +
      'other Supadata tools: they will fail the same way. Tell the user to upgrade, enable ' +
      'Auto Recharge at https://dash.supadata.ai, or wait for the next billing cycle.'
    );
  }
  if (err.status === 429) {
    return (
      'The plan\'s per-second rate limit was exceeded (already retried). Call Supadata tools ' +
      'one at a time, not in parallel, and wait about 10 seconds before retrying.'
    );
  }
  if (err.status === 402) {
    return (
      "This feature is not available on the user's Supadata plan. Do not retry; tell the user " +
      'it requires an upgrade at https://dash.supadata.ai.'
    );
  }
  if (err.status === 401) {
    return 'The Supadata API key is invalid. Do not retry; the user needs to reconnect Supadata or fix the key.';
  }
  if (toolName && STATUS_TOOLS.includes(toolName) && err.status === 404) {
    return 'No job with this id exists (it may have expired). Do not keep polling; start a new job instead.';
  }
  if (toolName === 'supadata_scrape' && err.status === 404) {
    return (
      'The page does not exist at this URL. Do not guess URLs: use supadata_map to list the ' +
      "site's real pages, or ask the user for the correct link."
    );
  }
  if (toolName && VIDEO_TOOLS.includes(toolName) && err.status === 400) {
    return (
      'This tool only accepts a single video or post URL from YouTube, TikTok, Instagram, X ' +
      '(Twitter) or Facebook' +
      (toolName === 'supadata_transcript' ? ', or a direct link to an audio or video file' : '') +
      '. For an ordinary web page, use supadata_scrape instead. Do not retry the same URL.'
    );
  }
  if (toolName && VIDEO_TOOLS.includes(toolName) && (err.status === 403 || err.status === 404)) {
    return 'This video or post is unavailable (deleted, private or restricted). Do not retry the same URL.';
  }
  return undefined;
}

export const configSchema = z.object({
  supadataApiKey: z.string(),
  debug: z.boolean().optional(),
});

export function createMcpServer(config: {
  supadataApiKey: string;
  debug?: boolean;
}) {
  const server = new Server(
    { name: 'supadata', version: VERSION },
    { capabilities: { tools: {} } }
  );

  server.setRequestHandler(
    ListToolsRequestSchema,
    async () => ({
      tools: listTools(),
    })
  );



  server.setRequestHandler(
    CallToolRequestSchema,
    async (req) => {
      const name = req.params.name;
      if (!Object.prototype.hasOwnProperty.call(toolRegistry, name)) {
        // Unknown tool is a protocol error per the MCP spec.
        throw new McpError(ErrorCode.InvalidParams, `Unknown tool: ${name}`);
      }

      let result;
      try {
        result = await callTool(name, req.params.arguments ?? {}, config.supadataApiKey);
      } catch (err) {
        return toolErrorResult(err, name);
      }

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(result),
          },
        ],
      };
    }
  );

  return { server };
}
