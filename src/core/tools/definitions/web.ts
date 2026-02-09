/**
 * Bluehawks CLI - Web Tools
 * Tools for fetching web content
 */

import { toolRegistry, type ToolHandler } from '../registry.js';
import { DEFAULT_TIMEOUT_MS } from '../../../config/constants.js';

const fetchUrlTool: ToolHandler = {
    name: 'fetch_url',
    safeToAutoRun: true,
    definition: {
        type: 'function',
        function: {
            name: 'fetch_url',
            description:
                'Fetch content from a URL. Useful for reading documentation, API responses, or web pages.',
            parameters: {
                type: 'object',
                properties: {
                    url: {
                        type: 'string',
                        description: 'The URL to fetch.',
                    },
                    method: {
                        type: 'string',
                        enum: ['GET', 'POST', 'PUT', 'DELETE'],
                        description: 'HTTP method. Default is GET.',
                    },
                    headers: {
                        type: 'object',
                        description: 'Optional HTTP headers as key-value pairs.',
                    },
                    body: {
                        type: 'string',
                        description: 'Optional request body for POST/PUT.',
                    },
                    timeout: {
                        type: 'number',
                        description: 'Timeout in milliseconds.',
                    },
                },
                required: ['url'],
            },
        },
    },
    async execute(args) {
        const url = args.url as string;
        const method = (args.method as string) || 'GET';
        const headers = (args.headers as Record<string, string>) || {};
        const body = args.body as string | undefined;
        const timeout = (args.timeout as number) || DEFAULT_TIMEOUT_MS;

        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), timeout);

        try {
            const response = await fetch(url, {
                method,
                headers: {
                    'User-Agent': 'Bluehawks-CLI/1.0',
                    ...headers,
                },
                body: body && ['POST', 'PUT'].includes(method) ? body : undefined,
                signal: controller.signal,
            });

            clearTimeout(timeoutId);

            const contentType = response.headers.get('content-type') || '';
            let content: string;

            if (contentType.includes('application/json')) {
                const json = await response.json();
                content = JSON.stringify(json, null, 2);
            } else {
                content = await response.text();

                // Simple HTML to text conversion
                if (contentType.includes('text/html')) {
                    content = content
                        .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '')
                        .replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, '')
                        .replace(/<[^>]+>/g, '\n')
                        .replace(/&nbsp;/g, ' ')
                        .replace(/&lt;/g, '<')
                        .replace(/&gt;/g, '>')
                        .replace(/&amp;/g, '&')
                        .replace(/\n\s*\n/g, '\n\n')
                        .trim();
                }
            }

            // Truncate if too long
            const maxLength = 50000;
            if (content.length > maxLength) {
                content = content.substring(0, maxLength) + '\n... (content truncated)';
            }

            return `Status: ${response.status} ${response.statusText}\n\n${content}`;
        } catch (error) {
            clearTimeout(timeoutId);
            if (error instanceof Error && error.name === 'AbortError') {
                throw new Error('Request timed out');
            }
            throw error;
        }
    },
};

export function registerWebTools(): void {
    toolRegistry.register(fetchUrlTool);
}
