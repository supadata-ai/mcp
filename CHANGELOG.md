# Changelog

## [Unreleased]

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
