# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

This is a Model Context Protocol (MCP) server implementation for Supadata web scraping and video transcript integration. The project provides six main tools: `supadata_transcript`, `supadata_check_transcript_status`, `supadata_scrape`, `supadata_map`, `supadata_crawl`, and `supadata_check_crawl_status` for video transcription, web scraping, URL discovery, and batch crawling operations.

## Key Commands

### Development Commands
- `npm run build` - Compile TypeScript to JavaScript and make executable
- `npm run test` - Run Jest tests with ESM support
- `npm run lint` - Run ESLint on TypeScript files
- `npm run lint:fix` - Run ESLint with auto-fix
- `npm run format` - Format code with Prettier
- `npm run start` - Start the server (defaults to STDIO transport)
- `npm run start:stdio` - Start with STDIO transport (legacy mode)
- `npm run start:http` - Start with HTTP Streamable transport
- `npm run dev:http` - Start HTTP server on port 3000 for development

### Single Test Execution
- `npm run test -- --testNamePattern="should handle scrape request"` - Run specific test
- `npm run test -- src/index.test.ts` - Run specific test file

## Architecture

### Transport Support
The server supports both transport modes as defined in the MCP specification:

#### STDIO Transport (Legacy Mode)
- **Protocol Version**: 2024-11-05 and earlier
- **Usage**: Suitable for local integrations and command-line tools
- **Start Command**: `npm run start:stdio` or `MCP_TRANSPORT_MODE=stdio npm start`
- **Communication**: JSON-RPC over standard input/output streams

#### HTTP Streamable Transport (Current Standard)
- **Protocol Version**: 2025-03-26
- **Usage**: Suitable for web-based integrations and remote server deployments
- **Start Command**: `npm run start:http` or `MCP_TRANSPORT_MODE=http npm start`
- **Endpoints**: 
  - `POST/GET/DELETE /mcp` - Main MCP endpoint
  - `GET /health` - Health check endpoint
- **Features**: Session management, resumability support, CORS enabled
- **Port**: Defaults to 3000 (configurable via `PORT` environment variable)

### MCP Server Structure
The server is built using the `@modelcontextprotocol/sdk` and supports both STDIO and HTTP Streamable transports. The main server logic is in `src/index.ts` with the following key components:

- **Server Creation**: `createServer()` function creates an McpServer instance
- **Tool Registration**: Six tools are registered with input validation using Zod schemas
- **Error Handling**: Comprehensive error handling with retry logic and exponential backoff
- **Configuration**: Environment-based configuration with defaults

### API Integration
The server integrates with Supadata's JavaScript SDK (`@supadata/js`) and provides:
- **Video Transcription**: Extract transcripts from YouTube, TikTok, Instagram, Twitter, and file URLs
- **Web Scraping**: Single page content extraction to Markdown
- **URL Mapping**: Website URL discovery and indexing
- **Crawling**: Asynchronous batch crawling of multiple pages
- **Status Checking**: Monitor crawl and transcript job progress and retrieve results

### Tool Implementations

#### supadata_transcript
- **Purpose**: Extract transcripts from video platforms and file URLs
- **Input**: `url` (string), `lang` (string optional), `text` (boolean), `chunkSize` (number optional), `mode` (enum optional)
- **Output**: Transcript content or job ID for async processing
- **Supported Platforms**: YouTube, TikTok, Instagram, Twitter, and file URLs

#### supadata_check_transcript_status
- **Purpose**: Check transcript job status and retrieve results
- **Input**: `id` (string - job ID from transcript)
- **Output**: Job status and transcript content (if completed)
- **Cost**: No additional cost

#### supadata_scrape
- **Purpose**: Extract content from single web pages
- **Input**: `url` (string), `noLinks` (boolean), `lang` (string)
- **Output**: Markdown-formatted content with metadata
- **Cost**: 1 credit per request

#### supadata_map
- **Purpose**: Discover all URLs on a website
- **Input**: `url` (string)  
- **Output**: Array of URLs found on the site
- **Cost**: 1 credit per request

#### supadata_crawl
- **Purpose**: Create asynchronous crawl jobs for multiple pages
- **Input**: `url` (string), `limit` (number, 1-5000, default 100)
- **Output**: Job ID for status tracking
- **Cost**: 1 credit for job creation + 1 credit per crawled page

#### supadata_check_crawl_status
- **Purpose**: Check crawl job status and retrieve results
- **Input**: `id` (string - job ID from crawl)
- **Output**: Job status and results (if completed)
- **Cost**: No additional cost

## Configuration

### Required Environment Variables
- `SUPADATA_API_KEY` - Supadata API key for authentication

### Transport Configuration
- `MCP_TRANSPORT_MODE` - Transport mode: "stdio" (default) or "http"
- `PORT` - HTTP server port (default: 3000, only used in HTTP mode)

### Optional Environment Variables
- `SUPADATA_RETRY_MAX_ATTEMPTS` - Max retry attempts (default: 3)
- `SUPADATA_RETRY_INITIAL_DELAY` - Initial retry delay in ms (default: 1000)
- `SUPADATA_RETRY_MAX_DELAY` - Max retry delay in ms (default: 10000)
- `SUPADATA_RETRY_BACKOFF_FACTOR` - Backoff multiplier (default: 2)
- `SUPADATA_CREDIT_WARNING_THRESHOLD` - Credit warning level (default: 1000)
- `SUPADATA_CREDIT_CRITICAL_THRESHOLD` - Credit critical level (default: 100)

## Error Handling

The server includes robust error handling with:
- **Retry Logic**: Exponential backoff for rate-limited requests
- **Rate Limiting**: Automatic detection and handling of 429 errors
- **Error Formatting**: Consistent error response format
- **Logging**: Comprehensive logging to stderr for debugging

## Testing

The test suite uses Jest with TypeScript and ESM support. Tests cover:
- All six tool implementations
- Error handling scenarios
- Rate limiting behavior
- Mock-based testing with `@jest/globals`

Key test files:
- `src/index.test.ts` - Main test suite
- `jest.config.js` - Jest configuration for ESM
- `jest.setup.ts` - Test setup file

## Deployment

### STDIO Transport (Legacy)
- **NPX**: `npx -y @supadata/mcp`
- **Global Install**: `npm install -g @supadata/mcp`
- **MCP Integrations**: Cursor, VS Code, Claude Desktop, Windsurf

### HTTP Streamable Transport (Recommended)
- **Local Development**: `MCP_TRANSPORT_MODE=http npm start`
- **Production**: Deploy as HTTP service on port 3000 (or custom port)
- **Docker**: Using provided Dockerfile with HTTP transport mode
- **Cloud Deployment**: Suitable for AWS, Google Cloud, Azure, Heroku, etc.
- **Load Balancing**: Supports multiple instances with session management

### Environment Setup Examples

```bash
# STDIO mode (legacy)
export SUPADATA_API_KEY=your_api_key_here
npm run start:stdio

# HTTP mode (recommended)
export SUPADATA_API_KEY=your_api_key_here
export PORT=3000
npm run start:http

# Production HTTP deployment
export MCP_TRANSPORT_MODE=http
export PORT=8080
export SUPADATA_API_KEY=your_api_key_here
npm start
```

## Development Notes

- Uses TypeScript with strict mode enabled
- ES modules with .js extension imports
- Zod schemas for input validation
- Comprehensive error handling throughout
- Stdio transport for MCP communication
- Node.js 18+ required