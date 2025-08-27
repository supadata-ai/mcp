# Supadata MCP Server

A Model Context Protocol (MCP) server implementation that integrates with [Supadata](https://supadata.ai) for video & web scraping capabilities.

## Features

- **Video transcript extraction** from YouTube, TikTok, Instagram, Twitter, and file URLs
- Web scraping, crawling, and discovery
- Automatic retries and rate limiting

> Play around with our MCP Server on [Smithery](https://smithery.ai/server/@supadata-ai/mcp) or on [MCP.so's playground](https://mcp.so/playground?server_uuid=5aaa7226-5a7b-47a7-993c-7c076e0e5d8c).

## Installation

### Running with npx

```bash
env SUPADATA_API_KEY=your-api-key npx -y @supadata/mcp
```

### Manual Installation

```bash
npm install -g @supadata/mcp
```

### Running on Cursor

Configuring Cursor 🖥️
Note: Requires Cursor version 0.45.6+
For the most up-to-date configuration instructions, please refer to the official Cursor documentation on configuring MCP servers:
[Cursor MCP Server Configuration Guide](https://docs.cursor.com/context/model-context-protocol#configuring-mcp-servers)

To configure Supadata MCP in Cursor **v0.48.6**

1. Open Cursor Settings
2. Go to Features > MCP Servers
3. Click "+ Add new global MCP server"
4. Enter the following code:
   ```json
   {
     "mcpServers": {
       "@supadata/mcp": {
         "command": "npx",
         "args": ["-y", "@supadata/mcp"],
         "env": {
           "SUPADATA_API_KEY": "YOUR-API-KEY"
         }
       }
     }
   }
   ```

To configure Supadata MCP in Cursor **v0.45.6**

1. Open Cursor Settings
2. Go to Features > MCP Servers
3. Click "+ Add New MCP Server"
4. Enter the following:
   - Name: "@supadata/mcp" (or your preferred name)
   - Type: "command"
   - Command: `env SUPADATA_API_KEY=your-api-key npx -y @supadata/mcp`

> If you are using Windows and are running into issues, try `cmd /c "set SUPADATA_API_KEY=your-api-key && npx -y @supadata/mcp"`

Replace `your-api-key` with your Supadata API key. If you don't have one yet, you can create an account and get it from https://www.supadata.dev/app/api-keys

After adding, refresh the MCP server list to see the new tools. The Composer Agent will automatically use Supadata MCP when appropriate, but you can explicitly request it by describing your web scraping needs. Access the Composer via Command+L (Mac), select "Agent" next to the submit button, and enter your query.

### Running on Windsurf

Add this to your `./codeium/windsurf/model_config.json`:

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

### Installing via Smithery

To install Supadata for Claude Desktop automatically via [Smithery](https://smithery.ai/server/@supadata-ai/mcp):

```bash
npx -y @smithery/cli install @supadata-ai/mcp --client claude
```

### Running on VS Code

For one-click installation, click one of the install buttons below...

[![Install with NPX in VS Code](https://img.shields.io/badge/VS_Code-NPM-0098FF?style=flat-square&logo=visualstudiocode&logoColor=white)](https://insiders.vscode.dev/redirect/mcp/install?name=@supadata/mcp&inputs=%5B%7B%22type%22%3A%22promptString%22%2C%22id%22%3A%22apiKey%22%2C%22description%22%3A%22Supadata%20API%20Key%22%2C%22password%22%3Atrue%7D%5D&config=%7B%22command%22%3A%22npx%22%2C%22args%22%3A%5B%22-y%22%2C%22@supadata/mcp%22%5D%2C%22env%22%3A%7B%22SUPADATA_API_KEY%22%3A%22%24%7Binput%3AapiKey%7D%22%7D%7D) [![Install with NPX in VS Code Insiders](https://img.shields.io/badge/VS_Code_Insiders-NPM-24bfa5?style=flat-square&logo=visualstudiocode&logoColor=white)](https://insiders.vscode.dev/redirect/mcp/install?name=@supadata/mcp&inputs=%5B%7B%22type%22%3A%22promptString%22%2C%22id%22%3A%22apiKey%22%2C%22description%22%3A%22Supadata%20API%20Key%22%2C%22password%22%3Atrue%7D%5D&config=%7B%22command%22%3A%22npx%22%2C%22args%22%3A%5B%22-y%22%2C%22@supadata/mcp%22%5D%2C%22env%22%3A%7B%22SUPADATA_API_KEY%22%3A%22%24%7Binput%3AapiKey%7D%22%7D%7D&quality=insiders)

For manual installation, add the following JSON block to your User Settings (JSON) file in VS Code. You can do this by pressing `Ctrl + Shift + P` and typing `Preferences: Open User Settings (JSON)`.

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

Optionally, you can add it to a file called `.vscode/mcp.json` in your workspace. This will allow you to share the configuration with others:

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

## Configuration

### Environment Variables

- `SUPADATA_API_KEY`: Your Supadata API key

### Usage with Claude Desktop

Add this to your `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "@supadata/mcp": {
      "command": "npx",
      "args": ["-y", "@supadata/mcp"],
      "env": {
        "SUPADATA_API_KEY": "YOUR_API_KEY_HERE"
      }
    }
  }
}
```

### System Configuration

The server includes several configurable parameters that can be set via environment variables. Here are the default values if not configured:

```typescript
const CONFIG = {
  retry: {
    maxAttempts: 3, // Number of retry attempts for rate-limited requests
    initialDelay: 1000, // Initial delay before first retry (in milliseconds)
    maxDelay: 10000, // Maximum delay between retries (in milliseconds)
    backoffFactor: 2, // Multiplier for exponential backoff
  },
};
```

### Rate Limiting and Batch Processing

The server utilizes Supadata's built-in rate limiting and batch processing capabilities:

- Automatic rate limit handling with exponential backoff
- Efficient parallel processing for batch operations
- Smart request queuing and throttling
- Automatic retries for transient errors

## How to Choose a Tool

Use this guide to select the right tool for your task:

- **If you need transcripts from video content:** use **transcript**
- **If you know the exact URL(s) you want:** use **scrape**
- **If you need to discover URLs on a site:** use **map**
- **If you want to analyze a whole site or section:** use **crawl** (with limits!)

### Quick Reference Table

| Tool       | Best for                            | Returns         |
| ---------- | ----------------------------------- | --------------- |
| transcript | Video transcript extraction         | text/markdown   |
| scrape     | Single page content                 | markdown/html   |
| map        | Discovering URLs on a site          | URL[]           |
| crawl      | Multi-page extraction (with limits) | markdown/html[] |

## Available Tools

### 1. Transcript Tool (`supadata_transcript`)

Extract transcripts from supported video platforms and file URLs.

**Best for:**

- Video content analysis and transcript extraction from YouTube, TikTok, Instagram, Twitter, and file URLs.

**Not recommended for:**

- Non-video content (use scrape for web pages)

**Common mistakes:**

- Using transcript for regular web pages (use scrape instead).

**Prompt Example:**

> "Get the transcript from this YouTube video: https://youtube.com/watch?v=example"

**Usage Example:**

```json
{
  "name": "supadata_transcript",
  "arguments": {
    "url": "https://youtube.com/watch?v=example",
    "lang": "en",
    "text": false,
    "mode": "auto"
  }
}
```

**Returns:**

- Transcript content in text or formatted output
- For async processing: Job ID for status checking

### 2. Check Transcript Status (`supadata_check_transcript_status`)

Check the status of a transcript job.

```json
{
  "name": "supadata_check_transcript_status",
  "arguments": {
    "id": "550e8400-e29b-41d4-a716-446655440000"
  }
}
```

**Returns:**

- Response includes the status of the transcript job with completion progress and results.

### 3. Scrape Tool (`supadata_scrape`)

Scrape content from a single URL with advanced options.

**Best for:**

- Single page content extraction, when you know exactly which page contains the information.

**Not recommended for:**

- Extracting content from multiple pages (use crawl for comprehensive multi-page extraction)

**Common mistakes:**

- Using scrape for a list of URLs (use crawl instead for multiple pages).

**Prompt Example:**

> "Get the content of the page at https://example.com."

**Usage Example:**

```json
{
  "name": "supadata_scrape",
  "arguments": {
    "url": "https://example.com",
    "noLinks": false,
    "lang": "en"
  }
}
```

**Returns:**

- URL of the scraped page
- Extracted content in Markdown format
- Page name and description
- Character count
- List of URLs found on the page

### 4. Map Tool (`supadata_map`)

Map a website to discover all indexed URLs on the site.

**Best for:**

- Discovering URLs on a website before deciding what to scrape
- Finding specific sections of a website

**Not recommended for:**

- When you already know which specific URL you need (use scrape)
- When you need the content of the pages (use scrape after mapping)

**Common mistakes:**

- Using crawl to discover URLs instead of map

**Prompt Example:**

> "List all URLs on example.com."

**Usage Example:**

```json
{
  "name": "supadata_map",
  "arguments": {
    "url": "https://example.com"
  }
}
```

**Returns:**

- Array of URLs found on the site

### 5. Crawl Tool (`supadata_crawl`)

Starts an asynchronous crawl job on a website and extract content from all pages.

**Best for:**

- Extracting content from multiple related pages, when you need comprehensive coverage.

**Not recommended for:**

- Extracting content from a single page (use scrape)
- When token limits are a concern (use map first to discover URLs, then scrape individual pages)
- When you need fast results (crawling can be slow)

**Warning:** Crawl responses can be very large and may exceed token limits. Limit the number of pages to crawl for better control.

**Common mistakes:**

- Setting limit too high (causes token overflow)
- Using crawl for a single page (use scrape instead)

**Prompt Example:**

> "Get all pages from example.com/blog."

**Usage Example:**

```json
{
  "name": "supadata_crawl",
  "arguments": {
    "url": "https://example.com/blog",
    "limit": 100
  }
}
```

**Returns:**

- Response includes operation ID for status checking:

```json
{
  "content": [
    {
      "type": "text",
      "text": "Started crawl for: https://example.com/* with job ID: 550e8400-e29b-41d4-a716-446655440000. Use supadata_check_crawl_status to check progress."
    }
  ],
  "isError": false
}
```

### 6. Check Crawl Status (`supadata_check_crawl_status`)

Check the status of a crawl job.

```json
{
  "name": "supadata_check_crawl_status",
  "arguments": {
    "id": "550e8400-e29b-41d4-a716-446655440000"
  }
}
```

**Returns:**

- Response includes the status of the crawl job with details on completion progress and results.

## Development

```bash
# Install dependencies
npm install

# Build
npm run build

# Dev (needs Smithery key)
npm run dev 

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
