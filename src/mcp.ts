import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import {
  ListToolsRequestSchema,
  CallToolRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';

async function callSupadata(path: string, args: any, apiKey: string, method: 'GET' | 'POST' = 'GET') {
  console.error(`[MCP] Calling Supadata: ${method} ${path}, Key length: ${apiKey?.length ?? 0}`);

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

const toolRegistry = {
  supadata_transcript: {
    schema: {
      name: 'supadata_transcript',
      description: 'Extract transcript from video or file URL',
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
      description: 'Check transcript job status',
      inputSchema: {
        type: 'object',
        properties: {
          id: { type: 'string' },
        },
        required: ['id'],
      },
    },
    handler: (args: any, apiKey: string) => {
      const id = args.id;
      return callSupadata(`/transcript/${id}`, {}, apiKey, 'GET');
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
      description: 'Create crawl job',
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
      description: 'Check crawl job status',
      inputSchema: {
        type: 'object',
        properties: {
          id: { type: 'string' },
        },
        required: ['id'],
      },
    },
    handler: (args: any, apiKey: string) => {
      const id = args.id;
      return callSupadata(`/web/crawl/${id}`, {}, apiKey, 'GET');
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
