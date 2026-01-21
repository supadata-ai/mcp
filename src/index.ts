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

  const { server } = createMcpServer(config);
  const transport = new StdioServerTransport();

  await server.connect(transport);
}

const isMainModule = process.argv[1] && import.meta.url === `file://${process.argv[1]}`;

if (process.env.RUN_STDIO || isMainModule) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}

export function createSandboxServer() {
  return createMcpServer({
    supadataApiKey: process.env.SUPADATA_API_KEY || 'sandbox-only',
    debug: false,
  }).server;
}

export default function () {
  return createSandboxServer();
}
