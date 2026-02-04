# Supadata MCP Server

A Model Context Protocol (MCP) server that integrates with [Supadata](https://supadata.ai) for video transcript extraction, web scraping, crawling, and site discovery.

## Features

- **Video transcript extraction** from YouTube, TikTok, Instagram, Twitter, and file URLs
- Web scraping, crawling, and URL discovery
- Automatic retries and rate limiting

## Remote MCP (Recommended)

Supadata MCP is available as a remote HTTP MCP server, hosted on Cloudflare Workers. This is the recommended way to use Supadata MCP with Claude Code.

### Install with Claude Code

```bash
claude mcp add --transport http supadata https://api.supadata.ai/mcp \
  --header "x-api-token: sd_YOUR_SUPADATA_API_TOKEN"
```

**Requirements:**
- Claude Code CLI
- Supadata API token

## Local MCP (Legacy / Advanced)

This method runs Supadata MCP locally using Node.js. For most users, the Remote MCP option above is recommended.

### Running with npx

```bash
env SUPADATA_API_KEY=your-api-key npx -y @supadata/mcp
```

### Manual Installation

```bash
npm install -g @supadata/mcp
```

### Running on Cursor

#### Cursor v0.48.6

Add to your Cursor Settings under Features > MCP Servers:

```json
{
  "mcpServers": {
    "@supadata/mcp": {
      "command": "npx",
      "args": ["-y", "@supadata/mcp"],
      "env": {
        "SUPADATA_API_KEY": "YOUR_API_KEY"
      }
    }
  }
}
```

#### Cursor v0.45.6

Add a new MCP Server with the following details:
- **Name:** `@supadata/mcp`
- **Type:** `command`
- **Command:** `env SUPADATA_API_KEY=your-api-key npx -y @supadata/mcp`

For Windows users:
```bash
cmd /c "set SUPADATA_API_KEY=your-api-key && npx -y @supadata/mcp"
```

### Running on Windsurf

Add this to `./codeium/windsurf/model_config.json`:

```json
{
  "mcpServers": {
    "@supadata/mcp": {
      "command": "npx",
      "args": ["-y", "@supadata/mcp"],
      "env": {
        "SUPADATA_API_KEY": "YOUR_API_KEY"
      }
    }
  }
}
```

### Running on VS Code

#### User Settings (JSON)

Press `Ctrl + Shift + P` and search for "Preferences: Open User Settings (JSON)", then add:

```json
{
  "mcp": {
    "inputs": [
      {
        "type": "promptString",
        "id": "apiKey",
        "description": "Supadata API Key",
        "password": true
      }
    ],
    "servers": {
      "supadata": {
        "command": "npx",
        "args": ["-y", "@supadata/mcp"],
        "env": {
          "SUPADATA_API_KEY": "${input:apiKey}"
        }
      }
    }
  }
}
```

#### Workspace Configuration (`.vscode/mcp.json`)

Optionally add this file to your workspace to share configuration with others:

```json
{
  "inputs": [
    {
      "type": "promptString",
      "id": "apiKey",
      "description": "Supadata API Key",
      "password": true
    }
  ],
  "servers": {
    "supadata": {
      "command": "npx",
      "args": ["-y", "@supadata/mcp"],
      "env": {
        "SUPADATA_API_KEY": "${input:apiKey}"
      }
    }
  }
}
```

### Usage with Claude Desktop (Local MCP only)

Add this to your `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "@supadata/mcp": {
      "command": "npx",
      "args": ["-y", "@supadata/mcp"],
      "env": {
        "SUPADATA_API_KEY": "YOUR_API_KEY"
      }
    }
  }
}
```

## Configuration

### Environment Variables

- `SUPADATA_API_KEY`: Your Supadata API key

### System Configuration

The server includes configurable retry and rate limiting parameters:

```typescript
const CONFIG = {
  retry: {
    maxAttempts: 3,           // Number of retry attempts
    initialDelay: 1000,       // Initial delay (milliseconds)
    maxDelay: 10000,          // Maximum delay between retries (milliseconds)
    backoffFactor: 2          // Exponential backoff multiplier
  }
};
```

## How to Choose a Tool

Select the right tool based on your needs:

- **Transcript:** Extract video transcripts from platforms and file URLs
- **Scrape:** Extract content from a single page when you know the exact URL
- **Map:** Discover all available URLs on a website
- **Crawl:** Extract content from multiple related pages comprehensively

| Tool | Best for | Returns |
|------|----------|---------|
| transcript | Video transcript extraction | text/markdown |
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