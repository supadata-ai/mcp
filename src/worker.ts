import { listTools, callTool } from './mcp.js';

export default {
  async fetch(req: Request): Promise<Response> {
    if (req.method !== 'POST') {
      return new Response('Method Not Allowed', { status: 405 });
    }

    const apiKey = req.headers.get('x-api-token');
    if (!apiKey) {
      return rpcError(null, -32001, 'Missing x-api-token');
    }

    let body: any;
    try {
      body = await req.json();
    } catch {
      return rpcError(null, -32700, 'Invalid JSON');
    }

    if (body?.jsonrpc !== '2.0' || typeof body.method !== 'string') {
      return rpcError(body?.id ?? null, -32600, 'Invalid Request');
    }

    const { id, method, params } = body;

    try {
      if (method === 'tools/list') {
        return rpcResult(id, { tools: listTools() });
      }

      if (method === 'tools/call') {
        if (!params?.name || !params?.arguments) {
          return rpcError(id, -32602, 'Invalid params');
        }

        const result = await callTool(
          params.name,
          params.arguments,
          apiKey
        );

        return rpcResult(id, result);
      }

      return rpcError(id, -32601, 'Method not found');
    } catch (err: any) {
      return rpcError(id, -32000, err?.message ?? 'Internal error');
    }
  },
};

function rpcResult(id: any, result: any) {
  return new Response(
    JSON.stringify({
      jsonrpc: '2.0',
      id,
      result,
    }),
    {
      headers: {
        'Content-Type': 'application/json',
      },
    }
  );
}

function rpcError(id: any, code: number, message: string) {
  return new Response(
    JSON.stringify({
      jsonrpc: '2.0',
      id,
      error: {
        code,
        message,
      },
    }),
    {
      status: 400,
      headers: {
        'Content-Type': 'application/json',
      },
    }
  );
}
