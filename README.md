# Supadata MCP Server

[![supadata-ai/mcp MCP server](https://glama.ai/mcp/servers/@supadata-ai/mcp/badges/score.svg)](https://glama.ai/mcp/servers/@supadata-ai/mcp)

Use [Supadata](https://supadata.ai) in your AI agent: video transcripts, media metadata, web scraping, crawling, and site discovery. This repository is the Supadata MCP server (Model Context Protocol), which AI agents like Claude, ChatGPT and Cursor use to call Supadata.

## Add to your AI agent

[![Add to Claude][badge-claude]](https://claude.ai/directory/supadata) [![Add to ChatGPT][badge-chatgpt]](https://chatgpt.com/plugins/plugin_asdk_app_6ad667a8ae4881919cbe3d48dbc3d759) [![Add to Cursor][badge-cursor]](https://cursor.com/en-US/install-mcp?name=supadata&config=eyJ1cmwiOiJodHRwczovL2FwaS5zdXBhZGF0YS5haS9tY3AifQ==)

Click a button, then sign in with your Supadata account. No API key to copy.

- **Claude:** click **Add to Claude**, click **Connect** and sign in. Works in claude.ai, Claude Desktop and the mobile apps. On Team/Enterprise plans an Owner enables Supadata first in Admin settings → Connectors.
- **ChatGPT:** click **Add to ChatGPT**, click **Connect** and sign in.
- **Cursor:** click **Add to Cursor**, confirm **Install**, and Cursor opens the Supadata sign-in page.

**Claude Code / Codex**

```bash
# Claude Code: then run /mcp and choose Authenticate
claude mcp add --transport http supadata https://api.supadata.ai/mcp

# Codex
codex mcp add supadata --url https://api.supadata.ai/mcp
codex mcp login supadata
```

Other MCP clients can connect to the hosted server at `https://api.supadata.ai/mcp` (OAuth, or an `x-api-key` header), or run the local server below.

[badge-claude]: https://img.shields.io/badge/Add_to_Claude-D97757?style=for-the-badge&logo=claude&logoColor=white
[badge-chatgpt]: https://img.shields.io/badge/Add_to_ChatGPT-000000?style=for-the-badge&logo=data:image/svg%2bxml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCAyNCAyNCI+PHBhdGggZmlsbD0id2hpdGUiIGQ9Ik0yMi4yODE5IDkuODIxMWE1Ljk4NDcgNS45ODQ3IDAgMCAwLS41MTU3LTQuOTEwOCA2LjA0NjIgNi4wNDYyIDAgMCAwLTYuNTA5OC0yLjlBNi4wNjUxIDYuMDY1MSAwIDAgMCA0Ljk4MDcgNC4xODE4YTUuOTg0NyA1Ljk4NDcgMCAwIDAtMy45OTc3IDIuOSA2LjA0NjIgNi4wNDYyIDAgMCAwIC43NDI3IDcuMDk2NiA1Ljk4IDUuOTggMCAwIDAgLjUxMSA0LjkxMDcgNi4wNTEgNi4wNTEgMCAwIDAgNi41MTQ2IDIuOTAwMUE1Ljk4NDcgNS45ODQ3IDAgMCAwIDEzLjI1OTkgMjRhNi4wNTU3IDYuMDU1NyAwIDAgMCA1Ljc3MTgtNC4yMDU4IDUuOTg5NCA1Ljk4OTQgMCAwIDAgMy45OTc3LTIuOTAwMSA2LjA1NTcgNi4wNTU3IDAgMCAwLS43NDc1LTcuMDcyOXptLTkuMDIyIDEyLjYwODFhNC40NzU1IDQuNDc1NSAwIDAgMS0yLjg3NjQtMS4wNDA4bC4xNDE5LS4wODA0IDQuNzc4My0yLjc1ODJhLjc5NDguNzk0OCAwIDAgMCAuMzkyNy0uNjgxM3YtNi43MzY5bDIuMDIgMS4xNjg2YS4wNzEuMDcxIDAgMCAxIC4wMzguMDUydjUuNTgyNmE0LjUwNCA0LjUwNCAwIDAgMS00LjQ5NDUgNC40OTQ0em0tOS42NjA3LTQuMTI1NGE0LjQ3MDggNC40NzA4IDAgMCAxLS41MzQ2LTMuMDEzN2wuMTQyLjA4NTIgNC43ODMgMi43NTgyYS43NzEyLjc3MTIgMCAwIDAgLjc4MDYgMGw1Ljg0MjgtMy4zNjg1djIuMzMyNGEuMDgwNC4wODA0IDAgMCAxLS4wMzMyLjA2MTVMOS43NCAxOS45NTAyYTQuNDk5MiA0LjQ5OTIgMCAwIDEtNi4xNDA4LTEuNjQ2NHpNMi4zNDA4IDcuODk1NmE0LjQ4NSA0LjQ4NSAwIDAgMSAyLjM2NTUtMS45NzI4VjExLjZhLjc2NjQuNzY2NCAwIDAgMCAuMzg3OS42NzY1bDUuODE0NCAzLjM1NDMtMi4wMjAxIDEuMTY4NWEuMDc1Ny4wNzU3IDAgMCAxLS4wNzEgMGwtNC44MzAzLTIuNzg2NUE0LjUwNCA0LjUwNCAwIDAgMSAyLjM0MDggNy44NzJ6bTE2LjU5NjMgMy44NTU4TDEzLjEwMzggOC4zNjQgMTUuMTE5MiA3LjJhLjA3NTcuMDc1NyAwIDAgMSAuMDcxIDBsNC44MzAzIDIuNzkxM2E0LjQ5NDQgNC40OTQ0IDAgMCAxLS42NzY1IDguMTA0MnYtNS42NzcyYS43OS43OSAwIDAgMC0uNDA3LS42Njd6bTIuMDEwNy0zLjAyMzFsLS4xNDItLjA4NTItNC43NzM1LTIuNzgxOGEuNzc1OS43NzU5IDAgMCAwLS43ODU0IDBMOS40MDkgOS4yMjk3VjYuODk3NGEuMDY2Mi4wNjYyIDAgMCAxIC4wMjg0LS4wNjE1bDQuODMwMy0yLjc4NjZhNC40OTkyIDQuNDk5MiAwIDAgMSA2LjY4MDIgNC42NnpNOC4zMDY1IDEyLjg2M2wtMi4wMi0xLjE2MzhhLjA4MDQuMDgwNCAwIDAgMS0uMDM4LS4wNTY3VjYuMDc0MmE0LjQ5OTIgNC40OTkyIDAgMCAxIDcuMzc1Ny0zLjQ1MzdsLS4xNDIuMDgwNUw4LjcwNCA1LjQ1OWEuNzk0OC43OTQ4IDAgMCAwLS4zOTI3LjY4MTN6bTEuMDk3Ni0yLjM2NTRsMi42MDItMS40OTk4IDIuNjA2OSAxLjQ5OTh2Mi45OTk0bC0yLjU5NzQgMS40OTk3LTIuNjA2Ny0xLjQ5OTdaIi8+PC9zdmc+
[badge-cursor]: https://img.shields.io/badge/Add_to_Cursor-000000?style=for-the-badge&logo=cursor&logoColor=white

## Features

- **Video transcript extraction** from YouTube, TikTok, Instagram, Twitter, and file URLs
- Web scraping, crawling, and URL discovery
- Media metadata retrieval from YouTube, TikTok, Instagram, and Twitter
- AI-powered structured data extraction from video content

## Installation

For step-by-step setup in Claude, ChatGPT, Cursor, Claude Code, Codex, Windsurf, VS Code and other AI agents, see the [AI agents guide](https://docs.supadata.ai/integrations/mcp).

## Running

### Stdio (default)

Running the package starts an MCP server on stdio. Use this when your AI agent
should spawn the server locally with your API key instead of using the hosted
server (for example a custom agent, or VS Code / Windsurf config files):

```bash
SUPADATA_API_KEY=your-api-key npx -y @supadata/mcp
```

Example client configuration:

```json
{
  "mcpServers": {
    "supadata": {
      "command": "npx",
      "args": ["-y", "@supadata/mcp"],
      "env": { "SUPADATA_API_KEY": "your-api-key" }
    }
  }
}
```

### Streamable HTTP (hosted)

The same tools are served over Streamable HTTP by the Cloudflare Worker in
`src/worker.ts`, deployed at `https://api.supadata.ai/mcp` with OAuth 2.1.
Run it locally with `npm run dev` (wrangler). Direct `x-api-key` header
authentication is also accepted on `/mcp`.

An OAuth connection stays alive while it is used and expires after 30 days
without use. Then clients have to log in again; Codex keeps retrying the
expired login instead of asking, so run `codex mcp login supadata` if Supadata
tools stop working in Codex.

## Configuration

### Environment Variables

- `SUPADATA_API_KEY`: Your Supadata API key (required for the stdio server). Get one at [dash.supadata.ai](https://dash.supadata.ai)
- `DEBUG`: set to `true` for verbose logging
- `RUN_STDIO`: set to `true` to force the stdio server to start when the module is imported rather than executed directly

## How to Choose a Tool

Select the right tool based on your needs:

- **Transcript:** Extract video transcripts from platforms and file URLs
- **Scrape:** Extract content from a single page when you know the exact URL
- **Map:** Discover all available URLs on a website
- **Crawl:** Extract content from multiple related pages comprehensively
- **Metadata:** Fetch metadata from media URLs (YouTube, TikTok, Instagram, Twitter)
- **Extract:** Extract structured data from video content using AI

| Tool | Best for | Returns |
|------|----------|---------|
| transcript | Video transcript extraction | text/markdown |
| metadata | Media metadata retrieval | JSON object |
| extract | AI-powered structured extraction | JSON object |
| scrape | Single page content | markdown/html |
| map | URL discovery on a site | URL[] |
| crawl | Multi-page extraction | markdown/html[] |

## Available Tools

### Transcript (`supadata_transcript`)

Extract transcripts from supported video platforms (YouTube, TikTok, Instagram, Twitter) and file URLs.

**Usage:**
```bash
supadata_transcript --url "https://youtube.com/watch?v=example" --lang "en"
```

### Check Transcript Status (`supadata_check_transcript_status`)

Check the progress of a transcript extraction job using the job ID.

**Usage:**
```bash
supadata_check_transcript_status --id "550e8400-e29b-41d4-a716-446655440000"
```

### Metadata (`supadata_metadata`)

Fetch metadata from a media URL on supported platforms (YouTube, TikTok, Instagram, Twitter). Returns platform info, title, description, author details, engagement stats, media details, tags, and creation date.

**Usage:**
```bash
supadata_metadata --url "https://youtube.com/watch?v=example"
```

### Extract (`supadata_extract`)

Extract structured data from a video URL using AI. Provide a prompt for what to extract, a JSON Schema for the output format, or both. Returns a job ID for async processing.

**Usage:**
```bash
supadata_extract --url "https://youtube.com/watch?v=example" --prompt "Extract the main topics discussed"
```

### Check Extract Status (`supadata_check_extract_status`)

Check the progress of an extract job using the job ID.

**Usage:**
```bash
supadata_check_extract_status --id "550e8400-e29b-41d4-a716-446655440000"
```

### Scrape (`supadata_scrape`)

Extract content from a single URL with advanced options.

**Usage:**
```bash
supadata_scrape --url "https://example.com" --lang "en"
```

### Map (`supadata_map`)

Discover all indexed URLs on a website to find relevant pages before scraping.

**Usage:**
```bash
supadata_map --url "https://example.com"
```

### Crawl (`supadata_crawl`)

Start an asynchronous crawl job to extract content from multiple pages on a site.

**Usage:**
```bash
supadata_crawl --url "https://example.com/blog" --limit 100
```

### Check Crawl Status (`supadata_check_crawl_status`)

Check the progress of a crawl job using the job ID.

**Usage:**
```bash
supadata_check_crawl_status --id "550e8400-e29b-41d4-a716-446655440000"
```

## Development

```bash
# Install dependencies
npm install

# Build
npm run build

# Run tests
npm test
```

### Contributing

1. Fork the repository
2. Create your feature branch
3. Run tests: `npm test`
4. Submit a pull request

## License

MIT License - see LICENSE file for details
