# Changelog

## [Unreleased]

## [1.3.6] - 2026-10-16

### Fixed

- Transcripts and scraped pages reach ChatGPT. ChatGPT gave the model `{}` for
  a JSON tool result with a top-level `content` key. For ChatGPT only, that
  key is now `transcript` (`supadata_transcript`,
  `supadata_check_transcript_status`) or `markdown` (`supadata_scrape`); other
  clients keep the REST API's `content`

## [1.3.5] - 2026-10-14

### Changed

- Hosted server OAuth: a connection no longer expires a fixed time after login.
  Every token refresh extends it to 30 days ahead, so it lasts as long as the
  client uses it and expires after 30 days without use. This also applies to
  connections made before the deploy, from their next refresh
- `@cloudflare/workers-oauth-provider` upgraded from 0.1.0 to 1.2.3. Existing
  connections and registered clients keep working without logging in again.
  Authorization requests from public clients must use S256 PKCE, and an
  authorization error found after the redirect URI is validated (such as
  missing PKCE) is sent back to the client's redirect URI instead of a 400

### Fixed

- The stdio server no longer writes its `[MCP] Calling Supadata…` log line to
  stdout, which is the JSON-RPC channel in stdio transport and could corrupt
  messages for MCP clients; logs now go to stderr. An ESLint `no-console` rule
  and a test that drives the stdio server keep stdout JSON-RPC only
- `/mcp` 401 responses carry `error="invalid_token"` again alongside
  `resource_metadata` in `WWW-Authenticate`; token endpoint 401s keep the
  provider's own challenge

### Added

- Failed `/oauth/token` requests are logged as `[OAuth Token Error]` with the
  error, grant type, client name and age, and whether the grant still exists
- `[OAuth Error]` log lines name the provider's internal reason, such as
  `refresh-token-grant/refresh_token_mismatch` or `grant_not_found`

## [1.3.4] - 2026-10-14

### Fixed

- Hosted server OAuth: path-aware discovery URLs
  (`/.well-known/oauth-protected-resource/mcp`,
  `/.well-known/oauth-authorization-server/mcp`) are served by the worker instead
  of returning 401 from the main API, and `/.well-known/openid-configuration`
  returns 404. The `/mcp` protected resource document names
  `https://api.supadata.ai/mcp` as its resource (RFC 9728 §3.3)
- Client registration responses no longer include a relative
  `registration_client_uri` for an endpoint the server does not implement
- A token request without a `resource` parameter no longer fails with a 500
  (the request body was read twice)
- An authorization request with an unknown `client_id` or unregistered
  `redirect_uri` returns a 400 OAuth error instead of a 500, and is logged with
  the client name and redirect URI
- A pending authorization now lasts 1 hour instead of 10 minutes, so a new user
  can sign up and verify their email before connecting
- The OAuth 401 for a token without an API key carries `WWW-Authenticate` with
  `resource_metadata`

### Changed

- Discovery documents are sent with `Cache-Control: public, max-age=3600`

## [1.3.3] - 2026-10-12

### Added

- Requests to the Supadata API now send a `User-Agent` of the form
  `supadata-mcp/<version> (<client>; <transport>)`, so API usage can be
  attributed to the AI client that made it. On the hosted server the client
  comes from the request headers (Claude, ChatGPT, Codex, Claude Code, Cursor),
  then the OAuth client's registered name, then the User-Agent's product
  name; over stdio it is the name the MCP client sends when it connects
- The OAuth authorize redirect to the dashboard includes a `client` parameter
  with the OAuth client's registered name, when known

## [1.3.2] - 2026-10-09

### Fixed

- Per-second rate limits (429 "Request rate limit…") are retried up to twice
  with backoff (or the API's `Retry-After`) before being reported, instead of
  failing the tool call
- An exhausted monthly quota (429 "Plan usage limit…") is no longer described as
  a rate limit: the error tells the model the credits are used up and not to
  retry or call other Supadata tools
- Error results now say whether retrying can help: unsupported URLs on video
  tools point to `supadata_scrape`, a 404 from `supadata_scrape` points to
  `supadata_map`, unknown job ids say to start a new job, and plan,
  authentication and unavailable-video errors say not to retry

### Changed

- Every tool input now has a description; `mode` is an enum, and `chunkSize`
  and the crawl `limit` declare their allowed ranges
- The transcript tool description lists the supported platforms and says it is
  not for ordinary web pages
- The npm package now ships only the compiled `dist/` output (plus README and
  LICENSE) instead of the whole repository: 8 files instead of 31
- Removed the unused `module` field, which pointed at TypeScript source

## [1.3.1] - 2026-10-03

### Fixed

- Failed tool calls (video not found, plan limit or rate limit reached, upstream
  errors, network failures) are now returned as tool results with `isError: true`
  and a readable message (HTTP status, error code, details, documentation link)
  instead of JSON-RPC protocol errors. Clients counted every such failure as a
  failed request and the model could not see why the call failed
- Rate-limit (429) errors include a hint to avoid parallel calls and wait before
  retrying
- Missing required arguments (e.g. a status check without `id`) are reported as
  a tool error instead of calling the API with `undefined`

## [1.3.0] - 2026-10-02

### Added

- Every tool now has a `title` and MCP tool annotations (`readOnlyHint`,
  `destructiveHint`, `idempotentHint`, `openWorldHint`), as required by the
  Claude connector directory

### Fixed

- The stdio server now starts when invoked through the npm bin symlink
  (`npx -y @supadata/mcp`, global installs); previously the entry-point check
  only matched a direct `node dist/index.js` invocation
- Clear "SUPADATA_API_KEY is required" error instead of a raw validation stack

### Changed

- Fuller descriptions for `supadata_scrape` and `supadata_map` saying what
  each returns and when to use it; `supadata_metadata` now lists Facebook
- README documents the default stdio transport and the Streamable HTTP worker

## [1.0.0] - 2025-07-13

### Added

- Initial release with basic scraping functionality
- Asynchronous crawl jobs with status polling
- URL discovery and crawling capabilities
- Rate limiting implementation
