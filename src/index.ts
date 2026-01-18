#!/usr/bin/env node

import dotenv from 'dotenv';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { createMcpServer, configSchema } from './mcp.js';

dotenv.config();

async function main() {
  const config = configSchema.parse({
    supadataApiKey: process.env.SUPADATA_API_KEY,
    debug: process.env.DEBUG === 'true',
  });

  const server = createMcpServer(config);
  const transport = new StdioServerTransport();

  await server.server.connect(transport);
}

if (process.env.RUN_STDIO) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}


export function createSandboxServer() {
  const server = createMcpServer({
    supadataApiKey: "sandbox-test-key",
    debug: false,
  });

  return server.server;
}

export default function () {
  return createSandboxServer();
}
