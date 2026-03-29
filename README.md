# Supadata MCP Server

[![smithery badge](https://smithery.ai/badge/supadata-ai/mcp)](https://smithery.ai/servers/supadata-ai/mcp)

A Model Context Protocol (MCP) server that integrates with [Supadata](https://supadata.ai) for video transcript extraction, web scraping, crawling, and site discovery.

## Features

- **Video transcript extraction** from YouTube, TikTok, Instagram, Twitter, and file URLs
- Web scraping, crawling, and URL discovery
- Media metadata retrieval from YouTube, TikTok, Instagram, and Twitter
- AI-powered structured data extraction from video content
- Automatic retries and rate limiting

## Installation

For setup instructions for Claude, ChatGPT, Cursor, Windsurf, VS Code, and other clients, see the [integration guide](https://docs.supadata.ai/integrations/mcp).

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