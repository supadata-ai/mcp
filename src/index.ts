#!/usr/bin/env node

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { Supadata } from '@supadata/js';
import { z } from 'zod';
import dotenv from 'dotenv';

dotenv.config();

// Configuration schema
export const configSchema = z.object({
  supadataApiKey: z.string().describe('Supadata API key for authentication'),
  debug: z.boolean().default(false).describe('Enable debug logging'),
});

// Input schemas for tools
const scrapeInputSchema = {
  url: z.string().describe('Web page URL to scrape'),
  noLinks: z
    .boolean()
    .default(false)
    .describe('When true, removes markdown links from the content'),
  lang: z
    .string()
    .default('en')
    .describe('Preferred language for the scraped content (ISO 639-1 code)'),
};

const mapInputSchema = {
  url: z.string().describe('URL of the website to map'),
};

const crawlInputSchema = {
  url: z.string().describe('URL of the webpage to crawl'),
  limit: z
    .number()
    .min(1)
    .max(5000)
    .default(100)
    .describe('Maximum number of pages to crawl (1-5000, default: 100)'),
};

const transcriptInputSchema = {
  url: z
    .string()
    .describe(
      'Video or file URL to get transcript from (YouTube, TikTok, Instagram, Twitter, file)'
    ),
  lang: z.string().optional().describe('Preferred language code (ISO 639-1)'),
  text: z
    .boolean()
    .default(false)
    .describe('Return plain text instead of formatted output'),
  chunkSize: z
    .number()
    .optional()
    .describe('Maximum characters per transcript chunk'),
  mode: z
    .enum(['native', 'auto', 'generate'])
    .optional()
    .describe('Transcript generation mode'),
};

const checkTranscriptStatusInputSchema = {
  id: z
    .string()
    .describe('Transcript job ID returned from supadata_transcript'),
};

const checkCrawlStatusInputSchema = {
  id: z.string().describe('Crawl job ID returned from supadata_crawl'),
};

// Configuration for retries and monitoring
const CONFIG = {
  retry: {
    maxAttempts: Number(process.env.SUPADATA_RETRY_MAX_ATTEMPTS) || 3,
    initialDelay: Number(process.env.SUPADATA_RETRY_INITIAL_DELAY) || 1000,
    maxDelay: Number(process.env.SUPADATA_RETRY_MAX_DELAY) || 10000,
    backoffFactor: Number(process.env.SUPADATA_RETRY_BACKOFF_FACTOR) || 2,
  },
};

// Utility functions
function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function trimResponseText(text: string): string {
  return text.trim();
}

// Add retry logic with exponential backoff
async function withRetry<T>(
  operation: () => Promise<T>,
  context: string,
  attempt = 1
): Promise<T> {
  try {
    return await operation();
  } catch (error) {
    const isRateLimit =
      error instanceof Error &&
      (error.message.includes('rate limit') || error.message.includes('429'));

    if (isRateLimit && attempt < CONFIG.retry.maxAttempts) {
      const delayMs = Math.min(
        CONFIG.retry.initialDelay *
          Math.pow(CONFIG.retry.backoffFactor, attempt - 1),
        CONFIG.retry.maxDelay
      );

      console.error(
        `Rate limit hit for ${context}. Attempt ${attempt}/${CONFIG.retry.maxAttempts}. Retrying in ${delayMs}ms`
      );

      await delay(delayMs);
      return withRetry(operation, context, attempt + 1);
    }

    throw error;
  }
}

export function createServer() {
  const server = new McpServer({
    name: '@supadata/mcp',
    version: '1.0.0',
  });

  // Get API key
  const SUPADATA_API_KEY = process.env.SUPADATA_API_KEY;

  // Check if API key is provided
  if (!SUPADATA_API_KEY && process.env.CLOUD_SERVICE !== 'true') {
    console.error('Error: SUPADATA_API_KEY environment variable is required');
    process.exit(1);
  }

  // Register transcript tool
  server.tool(
    'supadata_transcript',
    `Extract transcript from supported video platforms (YouTube, TikTok, Instagram, Twitter) or file URLs using Supadata's transcript API.

**Purpose:** Get transcripts from video content across multiple platforms.
**Best for:** Video content analysis, subtitle extraction, content indexing.

**Usage Example:**
\`\`\`json
{
  "name": "supadata_transcript",
  "arguments": {
    "url": "https://youtube.com/watch?v=example",
    "lang": "en",
    "text": false,
    "mode": "auto"
  }
}
\`\`\`

**Returns:** 
- Either immediate transcript content
- Or job ID for asynchronous processing (use supadata_check_transcript_status)

**Supported Platforms:** YouTube, TikTok, Instagram, Twitter, and file URLs`,
    transcriptInputSchema,
    async ({ url, lang, text, chunkSize, mode }) => {
      const apiKey = process.env.CLOUD_SERVICE
        ? process.env.SUPADATA_API_KEY
        : SUPADATA_API_KEY;

      if (process.env.CLOUD_SERVICE && !apiKey) {
        throw new Error('No API key provided');
      }

      const client = new Supadata({
        apiKey: apiKey as string,
      });

      try {
        const transcriptStartTime = Date.now();
        console.error(
          `Starting transcript for URL: ${url} with options: ${JSON.stringify({ lang, text, chunkSize, mode })}`
        );

        const options: any = { url };
        if (lang) options.lang = lang;
        if (text !== undefined) options.text = text;
        if (chunkSize) options.chunkSize = chunkSize;
        if (mode) options.mode = mode;

        const response = await client.transcript(options);

        console.error(
          `Transcript completed in ${Date.now() - transcriptStartTime}ms`
        );

        // Check if response contains a job ID (async processing)
        if (
          typeof response === 'object' &&
          response !== null &&
          'jobId' in response
        ) {
          const jobId = (response as any).jobId;
          return {
            content: [
              {
                type: 'text',
                text: trimResponseText(
                  `Started transcript job for ${url} with job ID: ${jobId}. Use supadata_check_transcript_status to check progress.`
                ),
              },
            ],
          };
        }

        return {
          content: [
            {
              type: 'text',
              text: trimResponseText(
                typeof response === 'string'
                  ? response
                  : JSON.stringify(response, null, 2)
              ),
            },
          ],
        };
      } catch (error) {
        const errorMessage =
          error instanceof Error ? error.message : String(error);
        throw new Error(errorMessage);
      }
    }
  );

  // Register check transcript status tool
  server.tool(
    'supadata_check_transcript_status',
    `Check the status and retrieve results of a transcript job created with supadata_transcript.

**Purpose:** Monitor transcript job progress and retrieve completed results.
**Workflow:** Use the job ID returned from supadata_transcript to check status and get results.

**Usage Example:**
\`\`\`json
{
  "name": "supadata_check_transcript_status",
  "arguments": {
    "id": "550e8400-e29b-41d4-a716-446655440000"
  }
}
\`\`\`

**Returns:** 
- Job status: 'queued', 'active', 'completed', 'failed'
- For completed jobs: Full transcript content
- Error details if job failed

**Tip:** Poll this endpoint periodically until status is 'completed' or 'failed'.`,
    checkTranscriptStatusInputSchema,
    async ({ id }) => {
      const apiKey = process.env.CLOUD_SERVICE
        ? process.env.SUPADATA_API_KEY
        : SUPADATA_API_KEY;

      if (process.env.CLOUD_SERVICE && !apiKey) {
        throw new Error('No API key provided');
      }

      const client = new Supadata({
        apiKey: apiKey as string,
      });

      const response = await client.transcript.getJobStatus(id);

      return {
        content: [
          {
            type: 'text',
            text: trimResponseText(JSON.stringify(response, null, 2)),
          },
        ],
      };
    }
  );

  // Register scrape tool
  server.tool(
    'supadata_scrape',
    `Extract content from any web page to Markdown format using Supadata's powerful scraping API.

**Purpose:** Single page content extraction with automatic formatting to Markdown.
**Best for:** When you know exactly which page contains the information you need.

**Usage Example:**
\`\`\`json
{
  "name": "supadata_scrape",
  "arguments": {
    "url": "https://example.com",
    "noLinks": false,
    "lang": "en"
  }
}
\`\`\`

**Returns:** 
- URL of the scraped page
- Extracted content in Markdown format
- Page name and description
- Character count
- List of URLs found on the page`,
    scrapeInputSchema,
    async ({ url, noLinks, lang }) => {
      const apiKey = process.env.CLOUD_SERVICE
        ? process.env.SUPADATA_API_KEY // In cloud service mode, get from env
        : SUPADATA_API_KEY;

      if (process.env.CLOUD_SERVICE && !apiKey) {
        throw new Error('No API key provided');
      }

      const client = new Supadata({
        apiKey: apiKey as string,
      });

      try {
        const scrapeStartTime = Date.now();
        console.error(
          `Starting scrape for URL: ${url} with options: ${JSON.stringify({ noLinks, lang })}`
        );

        const response = await client.web.scrape(url);

        console.error(`Scrape completed in ${Date.now() - scrapeStartTime}ms`);

        return {
          content: [
            {
              type: 'text',
              text: trimResponseText(
                typeof response === 'string'
                  ? response
                  : JSON.stringify(response, null, 2)
              ),
            },
          ],
        };
      } catch (error) {
        const errorMessage =
          error instanceof Error ? error.message : String(error);
        throw new Error(errorMessage);
      }
    }
  );

  // Register map tool
  server.tool(
    'supadata_map',
    `Crawl a whole website and get all URLs on it using Supadata's mapping API.

**Purpose:** Extract all links found on a website for content discovery and sitemap creation.
**Best for:** Website content discovery, SEO analysis, content aggregation, automated web scraping and indexing.
**Use cases:** Creating a sitemap, running a crawler to fetch content from all pages of a website.

**Usage Example:**
\`\`\`json
{
  "name": "supadata_map",
  "arguments": {
    "url": "https://example.com"
  }
}
\`\`\`

**Returns:** Array of URLs found on the website.`,
    mapInputSchema,
    async ({ url }) => {
      const apiKey = process.env.CLOUD_SERVICE
        ? process.env.SUPADATA_API_KEY
        : SUPADATA_API_KEY;

      if (process.env.CLOUD_SERVICE && !apiKey) {
        throw new Error('No API key provided');
      }

      const client = new Supadata({
        apiKey: apiKey as string,
      });

      const response = await client.web.map(url);
      const urls = Array.isArray(response) ? response : [response];

      return {
        content: [
          {
            type: 'text',
            text: trimResponseText(urls.join('\n')),
          },
        ],
      };
    }
  );

  // Register crawl tool
  server.tool(
    'supadata_crawl',
    `Create a crawl job to extract content from all pages on a website using Supadata's crawling API.

**Purpose:** Crawl a whole website and get content of all pages on it.
**Best for:** Extracting content from multiple related pages when you need comprehensive coverage.
**Workflow:** 1) Create crawl job → 2) Receive job ID → 3) Check job status and retrieve results

**Crawling Behavior:**
- Follows only child links within the specified domain
- Example: For https://supadata.ai/blog, crawls https://supadata.ai/blog/article-1 but not https://supadata.ai/about
- To crawl entire website, use top-level URL like https://supadata.ai

**Usage Example:**
\`\`\`json
{
  "name": "supadata_crawl",
  "arguments": {
    "url": "https://example.com",
    "limit": 100
  }
}
\`\`\`

**Returns:** Job ID for status checking. Use supadata_check_crawl_status to check progress.
**Job Status:** Possible statuses are 'scraping', 'completed', 'failed', or 'cancelled'

**Important:** Respect robots.txt and website terms of service when crawling web content.`,
    crawlInputSchema,
    async ({ url, limit }) => {
      const apiKey = process.env.CLOUD_SERVICE
        ? process.env.SUPADATA_API_KEY
        : SUPADATA_API_KEY;

      if (process.env.CLOUD_SERVICE && !apiKey) {
        throw new Error('No API key provided');
      }

      const client = new Supadata({
        apiKey: apiKey as string,
      });

      const response = await withRetry(
        async () =>
          client.web.crawl({
            url,
            limit: limit || 100,
          }),
        'crawl operation'
      );

      const jobId = (response as any).jobId || (response as any).id || response;

      return {
        content: [
          {
            type: 'text',
            text: trimResponseText(
              `Started crawl for ${url} with job ID: ${jobId}. Use supadata_check_crawl_status to check progress.`
            ),
          },
        ],
      };
    }
  );

  // Register check crawl status tool
  server.tool(
    'supadata_check_crawl_status',
    `Check the status and retrieve results of a crawl job created with supadata_crawl.

**Purpose:** Monitor crawl job progress and retrieve completed results.
**Workflow:** Use the job ID returned from supadata_crawl to check status and get results.

**Usage Example:**
\`\`\`json
{
  "name": "supadata_check_crawl_status",
  "arguments": {
    "id": "550e8400-e29b-41d4-a716-446655440000"
  }
}
\`\`\`

**Returns:** 
- Job status: 'scraping', 'completed', 'failed', or 'cancelled'
- For completed jobs: URL, Markdown content, page title, and description for each crawled page
- Progress information and any error details if applicable

**Tip:** Poll this endpoint periodically until status is 'completed' or 'failed'.`,
    checkCrawlStatusInputSchema,
    async ({ id }) => {
      const apiKey = process.env.CLOUD_SERVICE
        ? process.env.SUPADATA_API_KEY
        : SUPADATA_API_KEY;

      if (process.env.CLOUD_SERVICE && !apiKey) {
        throw new Error('No API key provided');
      }

      const client = new Supadata({
        apiKey: apiKey as string,
      });

      const response = await client.web.getCrawlResults(id);

      return {
        content: [
          {
            type: 'text',
            text: trimResponseText(JSON.stringify(response, null, 2)),
          },
        ],
      };
    }
  );

  return server.server;
}

// Server startup for STDIO transport
async function runStdioServer() {
  try {
    console.error('Initializing Supadata MCP Server with STDIO transport...');

    const server = createServer();
    const transport = new StdioServerTransport();

    console.error('Running in stdio mode, logging will be directed to stderr');

    await server.connect(transport);

    console.error('Supadata MCP Server initialized successfully');
    console.error('Supadata MCP Server running on stdio');
  } catch (error) {
    console.error('Fatal error running STDIO server:', error);
    process.exit(1);
  }
}

// Server startup logic - support both STDIO and HTTP modes
async function runServer() {
  const transportMode = process.env.MCP_TRANSPORT_MODE || 'stdio';
  
  if (transportMode === 'http') {
    // Import and run HTTP server
    const { runHttpServer } = await import('./httpServer.js');
    const port = process.env.PORT ? parseInt(process.env.PORT) : 3000;
    await runHttpServer(port);
  } else {
    // Default to STDIO transport
    await runStdioServer();
  }
}

// Only run the server if this file is executed directly
if (import.meta.url === `file://${process.argv[1]}`) {
  runServer().catch((error: any) => {
    console.error('Fatal error running server:', error);
    process.exit(1);
  });
}

// Default export for compatibility
export default createServer;
