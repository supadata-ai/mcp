# Changelog

## [Unreleased]

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
