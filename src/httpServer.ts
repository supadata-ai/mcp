#!/usr/bin/env node

import express from 'express';
import cors from 'cors';
import { randomUUID } from 'node:crypto';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { isInitializeRequest } from '@modelcontextprotocol/sdk/types.js';
import createServer from './index.js';

/**
 * HTTP server implementation using Streamable HTTP transport
 * Based on MCP specification version 2025-03-26
 */

const app = express();
app.use(express.json());

// Configure CORS to expose Mcp-Session-Id header for browser-based clients
app.use(cors({
  origin: '*', // Allow all origins - adjust as needed for production
  exposedHeaders: ['Mcp-Session-Id']
}));

// Store transports by session ID for session management
const transports: Record<string, StreamableHTTPServerTransport> = {};

// Handle all MCP Streamable HTTP requests (GET, POST, DELETE) on a single endpoint
app.all('/mcp', async (req, res) => {
  console.error(`Received ${req.method} request to /mcp`);
  
  try {
    // Check for existing session ID
    const sessionId = req.headers['mcp-session-id'] as string;
    let transport: StreamableHTTPServerTransport;

    if (sessionId && transports[sessionId]) {
      // Reuse existing transport
      transport = transports[sessionId];
    } else if (!sessionId && req.method === 'POST' && isInitializeRequest(req.body)) {
      // Create new transport for initialization request
      transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: () => randomUUID(),
        onsessioninitialized: (sessionId: string) => {
          console.error(`StreamableHTTP session initialized with ID: ${sessionId}`);
          transports[sessionId] = transport;
        }
      });

      // Set up onclose handler to clean up transport when closed
      transport.onclose = () => {
        const sid = transport.sessionId;
        if (sid && transports[sid]) {
          console.error(`Transport closed for session ${sid}, removing from transports map`);
          delete transports[sid];
        }
      };

      // Connect the transport to the MCP server
      const server = createServer();
      await server.connect(transport);
    } else {
      // Invalid request - no session ID or not initialization request
      res.status(400).json({
        jsonrpc: '2.0',
        error: {
          code: -32000,
          message: 'Bad Request: No valid session ID provided or not an initialization request',
        },
        id: null,
      });
      return;
    }

    // Handle the request with the transport
    await transport.handleRequest(req, res, req.body);
  } catch (error) {
    console.error('Error handling MCP request:', error);
    if (!res.headersSent) {
      res.status(500).json({
        jsonrpc: '2.0',
        error: {
          code: -32603,
          message: 'Internal server error',
        },
        id: null,
      });
    }
  }
});

// Health check endpoint
app.get('/health', (_req, res) => {
  res.json({ status: 'ok', transport: 'streamable-http' });
});

// Start the HTTP server
export async function runHttpServer(port: number = 3000) {
  return new Promise<void>((resolve, reject) => {
    try {
      console.error('Initializing Supadata MCP Server with HTTP transport...');
      
      const server = app.listen(port, () => {
        console.error(`Supadata MCP Server running on HTTP transport at port ${port}`);
        console.error('MCP endpoint: POST/GET/DELETE /mcp');
        console.error('Health check: GET /health');
        resolve();
      });

      server.on('error', reject);

      // Handle server shutdown
      process.on('SIGINT', async () => {
        console.error('Shutting down HTTP server...');
        
        // Close all active transports
        for (const sessionId in transports) {
          try {
            console.error(`Closing transport for session ${sessionId}`);
            await transports[sessionId].close();
            delete transports[sessionId];
          } catch (error) {
            console.error(`Error closing transport for session ${sessionId}:`, error);
          }
        }

        server.close(() => {
          console.error('HTTP server shutdown complete');
          process.exit(0);
        });
      });

      process.on('SIGTERM', async () => {
        console.error('Shutting down HTTP server...');
        
        // Close all active transports
        for (const sessionId in transports) {
          try {
            console.error(`Closing transport for session ${sessionId}`);
            await transports[sessionId].close();
            delete transports[sessionId];
          } catch (error) {
            console.error(`Error closing transport for session ${sessionId}:`, error);
          }
        }

        server.close(() => {
          console.error('HTTP server shutdown complete');
          process.exit(0);
        });
      });

    } catch (error) {
      console.error('Fatal error starting HTTP server:', error);
      reject(error);
    }
  });
}

// Only run the server if this file is executed directly
if (import.meta.url === `file://${process.argv[1]}`) {
  const port = process.env.PORT ? parseInt(process.env.PORT) : 3000;
  runHttpServer(port).catch((error: any) => {
    console.error('Fatal error running HTTP server:', error);
    process.exit(1);
  });
}