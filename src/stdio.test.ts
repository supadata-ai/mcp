import { describe, expect, test } from '@jest/globals';
import { spawn } from 'node:child_process';
import { join } from 'node:path';

// In stdio transport stdout is the JSON-RPC channel, so anything else written
// there (a stray console.log) corrupts the stream. This runs the real stdio
// entry point, drives a handshake, a tool list and a tool call, and checks that
// every stdout line is a JSON-RPC message while the logs land on stderr.

// Preloaded into the server process so the tool call never reaches the network.
const STUB_FETCH =
  'data:text/javascript,' +
  encodeURIComponent(
    `globalThis.fetch = async () => new Response(JSON.stringify({ content: '# Stub' }), { status: 200, headers: { 'content-type': 'application/json' } });`
  );

const requests = [
  {
    jsonrpc: '2.0',
    id: 1,
    method: 'initialize',
    params: {
      protocolVersion: '2025-06-18',
      capabilities: {},
      clientInfo: { name: 'stdio-test', version: '0.0.0' },
    },
  },
  { jsonrpc: '2.0', method: 'notifications/initialized' },
  { jsonrpc: '2.0', id: 2, method: 'tools/list' },
  {
    jsonrpc: '2.0',
    id: 3,
    method: 'tools/call',
    params: { name: 'supadata_scrape', arguments: { url: 'https://example.com' } },
  },
];

function runStdioServer(): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(
      process.execPath,
      ['--import', 'tsx', '--import', STUB_FETCH, join(process.cwd(), 'src/index.ts')],
      {
        env: { ...process.env, SUPADATA_API_KEY: 'test-api-key', DEBUG: 'true' },
        stdio: ['pipe', 'pipe', 'pipe'],
      }
    );

    let stdout = '';
    let stderr = '';
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error(`stdio server timed out.\nstdout:\n${stdout}\nstderr:\n${stderr}`));
    }, 20000);

    child.stdout.on('data', (chunk) => {
      stdout += chunk;
      // Done once the response to the last request has arrived.
      if (/"id":3[,}]/.test(stdout) && stdout.endsWith('\n')) {
        clearTimeout(timer);
        child.kill();
      }
    });
    child.stderr.on('data', (chunk) => {
      stderr += chunk;
    });
    child.on('error', reject);
    child.on('close', () => {
      clearTimeout(timer);
      resolve({ stdout, stderr });
    });

    for (const request of requests) {
      child.stdin.write(JSON.stringify(request) + '\n');
    }
  });
}

describe('stdio transport', () => {
  test('writes only JSON-RPC messages to stdout', async () => {
    const { stdout, stderr } = await runStdioServer();
    expect(stdout).not.toBe('');

    const lines = stdout.split('\n').filter((line) => line.trim() !== '');
    const messages = lines.map((line) => {
      let message: any;
      try {
        message = JSON.parse(line);
      } catch {
        throw new Error(`Non-JSON line on stdout: ${line}`);
      }
      expect(message.jsonrpc).toBe('2.0');
      return message;
    });

    const byId = new Map(messages.map((m) => [m.id, m]));
    expect(byId.get(1)?.result?.serverInfo).toBeDefined();
    expect(byId.get(2)?.result?.tools?.length).toBeGreaterThan(0);
    expect(byId.get(3)?.result?.content).toBeDefined();

    // The tool call logs, and that log went to stderr rather than stdout.
    expect(stderr).toContain('[MCP] Calling Supadata');
  });
});
