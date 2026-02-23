import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import {
  ListToolsRequestSchema,
  CallToolRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';

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

  const res = await fetch(url, {
    method,
    headers,
    body,
  });

  if (!res.ok) {
    const errorText = await res.text();
    console.error(`Supadata API Error (${res.status}): ${errorText}`);
    throw new Error(errorText);
  }

  return res.json();
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
      description: 'Extract transcript from a video or file URL. For large files, returns a jobId instead of the transcript directly - use supadata_check_transcript_status with that jobId to poll for results.',
      inputSchema: {
        type: 'object',
        properties: {
          url: { type: 'string' },
          lang: { type: 'string' },
          text: { type: 'boolean' },
          chunkSize: { type: 'number' },
          mode: { type: 'string' },
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
      description: 'Check transcript job status and retrieve results. Returns status: "queued", "active", "completed", or "failed". If status is not "completed" or "failed", call this tool again after a few seconds with the same id.',
      inputSchema: {
        type: 'object',
        properties: {
          id: { type: 'string' },
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
      description: 'Scrape a single web page',
      inputSchema: {
        type: 'object',
        properties: {
          url: { type: 'string' },
          noLinks: { type: 'boolean' },
          lang: { type: 'string' },
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
      description: 'Discover URLs on a website',
      inputSchema: {
        type: 'object',
        properties: {
          url: { type: 'string' },
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
      description: 'Create a crawl job to extract content from all pages on a website. Returns a jobId - use supadata_check_crawl_status with that jobId to poll for results.',
      inputSchema: {
        type: 'object',
        properties: {
          url: { type: 'string' },
          limit: { type: 'number' },
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
      description: 'Check crawl job status and retrieve results. Returns status: "scraping", "completed", "failed", or "cancelled". If status is "scraping", call this tool again after a few seconds with the same id.',
      inputSchema: {
        type: 'object',
        properties: {
          id: { type: 'string' },
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
      description: 'Fetch metadata from a media URL (YouTube, TikTok, Instagram, Twitter). Returns platform info, title, description, author details, engagement stats, media details, tags, and creation date.',
      inputSchema: {
        type: 'object',
        properties: {
          url: { type: 'string' },
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
      description: 'Extract structured data from a video URL using AI. Provide a prompt for what to extract, a JSON Schema for the output format, or both. Returns a jobId for async processing - use supadata_check_extract_status with that jobId to poll for results.',
      inputSchema: {
        type: 'object',
        properties: {
          url: { type: 'string' },
          prompt: { type: 'string' },
          schema: { type: 'object' },
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
      description: 'Check extract job status and retrieve results. Returns status: "queued", "active", "completed", or "failed". If status is not "completed" or "failed", call this tool again after a few seconds with the same id.',
      inputSchema: {
        type: 'object',
        properties: {
          id: { type: 'string' },
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
  if (!tool) {
    throw new Error(`Unknown tool: ${name}`);
  }
  return tool.handler(args, apiKey);
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
    { name: 'supadata', version: '1.0.0' },
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
      const result = await callTool(
        req.params.name,
        req.params.arguments,
        config.supadataApiKey
      );

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
