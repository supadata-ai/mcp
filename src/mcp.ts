import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import {
  ListToolsRequestSchema,
  CallToolRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';

type ToolHandler = (args: any, apiKey: string) => Promise<any>;

const toolRegistry: Record<
  string,
  {
    schema: {
      name: string;
      description: string;
      inputSchema: any;
    };
    handler: ToolHandler;
  }
> = {
  search: {
    schema: {
      name: 'search',
      description: 'Search using Supadata',
      inputSchema: {
        type: 'object',
        properties: { query: { type: 'string' } },
        required: ['query'],
      },
    },
    handler: async (args, apiKey) => {
      return { results: [{ query: args.query }] };
    },
  },

  extract: {
    schema: {
      name: 'extract',
      description: 'Extract using Supadata',
      inputSchema: {
        type: 'object',
        properties: { url: { type: 'string' } },
        required: ['url'],
      },
    },
    handler: async (args, apiKey) => {
      return { content: `Extracted from ${args.url}` };
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
  const tool = toolRegistry[name];
  if (!tool) throw new Error(`Unknown tool: ${name}`);
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
    async () => {
      return { tools: listTools() };
    }
  );

  server.setRequestHandler(
    CallToolRequestSchema,
    async (req) => {
      return callTool(
        req.params.name,
        req.params.arguments,
        config.supadataApiKey
      );
    }
  );

  return { server };
}


export function createSandboxServer() {
  return createMcpServer({
    supadataApiKey: "sandbox-test-key",
    debug: false,
  }).server;
}

export default function () {
  return createSandboxServer();
}
