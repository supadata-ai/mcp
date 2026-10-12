// Identify which AI client (Claude, ChatGPT, Codex, Cursor, ...) is calling the
// MCP server, so the User-Agent sent to the Supadata API can attribute traffic in
// the API request logs.

const MAX_CLIENT_LENGTH = 40;

/**
 * Reduce a client name to a short token that is safe inside a User-Agent comment:
 * only [A-Za-z0-9._-], other runs replaced by "-", at most 40 characters.
 * Returns undefined when nothing usable is left.
 */
export function sanitizeClientName(name: string | null | undefined): string | undefined {
  const cleaned = (name ?? '')
    .replace(/[^A-Za-z0-9._-]+/g, '-')
    .slice(0, MAX_CLIENT_LENGTH)
    .replace(/^[-.]+|[-.]+$/g, '');
  return cleaned || undefined;
}

// "Mozilla/5.0 (...)" -> "Mozilla", "node-fetch/1.0" -> "node-fetch": the product
// name of the first User-Agent token, without its version.
function userAgentFamily(userAgent: string): string | undefined {
  return sanitizeClientName(userAgent.trim().split(/[/\s(]/)[0]);
}

/**
 * Detect the client from the headers of an incoming hosted MCP request.
 * Returns "unknown" when neither the headers nor the User-Agent say anything.
 */
export function detectClient(headers: Pick<Headers, 'get'>): string {
  const userAgent = headers.get('user-agent') ?? '';

  const anthropicClient = sanitizeClientName(headers.get('x-anthropic-client'));
  if (anthropicClient) return `Claude-${anthropicClient}`;
  if (headers.get('x-openai-subject') || /openai-mcp/i.test(userAgent)) return 'ChatGPT';
  if (/codex-mcp-client/i.test(userAgent)) return 'Codex';
  if (/claude-code/i.test(userAgent)) return 'ClaudeCode-local';
  if (/^Claude-User/i.test(userAgent)) return 'Claude';
  if (/cursor/i.test(userAgent)) return 'Cursor';

  return userAgentFamily(userAgent) ?? 'unknown';
}
