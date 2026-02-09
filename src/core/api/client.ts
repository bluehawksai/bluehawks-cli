/**
 * Bluehawks CLI - API Client
 * OpenAI-compatible API client with streaming support
 */

import {
    API_BASE_URL,
    DEFAULT_MODEL,
    DEFAULT_MAX_TOKENS,
    DEFAULT_TEMPERATURE,
    DEFAULT_TIMEOUT_MS,
    MAX_RETRIES,
    RETRY_DELAY_MS,
} from '../../config/constants.js';
import {
    type APIClientOptions,
    type ChatCompletionRequest,
    type ChatCompletionResponse,
    type ChatCompletionChunk,
    type Message,
    type ToolCall,
    type ToolDefinition,
    type ToolResult,
    type StreamDelta,
    APIError,
} from './types.js';

export class APIClient {
    private baseUrl: string;
    private apiKey: string;
    private model: string;
    private maxTokens: number;
    private temperature: number;
    private timeout: number;

    constructor(options: APIClientOptions = {}) {
        this.baseUrl = options.baseUrl || process.env.BLUEHAWKS_API_URL || API_BASE_URL;
        this.apiKey = options.apiKey || process.env.BLUEHAWKS_API_KEY || '';
        this.model = options.model || process.env.BLUEHAWKS_MODEL || DEFAULT_MODEL;
        this.maxTokens = options.maxTokens || DEFAULT_MAX_TOKENS;
        this.temperature = options.temperature || DEFAULT_TEMPERATURE;
        this.timeout = options.timeout || DEFAULT_TIMEOUT_MS;
    }

    /**
     * Create a chat completion (non-streaming)
     */
    async createChatCompletion(
        messages: Message[],
        tools?: ToolDefinition[],
        toolChoice?: ChatCompletionRequest['tool_choice']
    ): Promise<ChatCompletionResponse> {
        const request: ChatCompletionRequest = {
            model: this.model,
            messages,
            max_tokens: this.maxTokens,
            temperature: this.temperature,
            stream: false,
        };

        if (tools && tools.length > 0) {
            request.tools = tools;
            request.tool_choice = toolChoice || 'auto';
        }

        const response = await this.makeRequest<ChatCompletionResponse>('/chat/completions', request);

        return response;
    }

    /**
     * Create a streaming chat completion
     */
    async *createStreamingChatCompletion(
        messages: Message[],
        _tools?: ToolDefinition[],
        _toolChoice?: ChatCompletionRequest['tool_choice']
    ): AsyncGenerator<ChatCompletionChunk> {
        const request: ChatCompletionRequest = {
            model: this.model,
            messages,
            max_tokens: this.maxTokens,
            temperature: this.temperature,
            stream: true,
        };

        // Note: Many vLLM backends don't support tool_choice in streaming mode
        // So we skip sending tools for streaming requests.
        // For tool-based workflows, use non-streaming createChatCompletion instead.

        const response = await this.fetchWithRetry('/chat/completions', {
            method: 'POST',
            headers: this.getHeaders(),
            body: JSON.stringify(request),
        });

        if (!response.ok) {
            const errorBody = await response.text();
            throw new APIError(`API request failed: ${response.status}`, response.status, errorBody);
        }

        if (!response.body) {
            throw new APIError('Response body is empty');
        }

        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';

        try {
            while (true) {
                const { done, value } = await reader.read();
                if (done) break;

                buffer += decoder.decode(value, { stream: true });
                const lines = buffer.split('\n');
                buffer = lines.pop() || '';

                for (const line of lines) {
                    const trimmed = line.trim();
                    if (!trimmed || trimmed === 'data: [DONE]') continue;
                    if (!trimmed.startsWith('data: ')) continue;

                    try {
                        const data = trimmed.slice(6);
                        const chunk = JSON.parse(data) as ChatCompletionChunk;
                        yield chunk;
                    } catch {
                        // Skip invalid JSON
                    }
                }
            }
        } finally {
            reader.releaseLock();
        }
    }

    /**
     * Convenience method to stream and collect tool calls
     */
    async streamChatCompletion(
        messages: Message[],
        tools?: ToolDefinition[],
        onChunk?: (content: string) => void,
        onToolCalls?: (toolCalls: ToolCall[]) => void
    ): Promise<{ content: string; toolCalls: ToolCall[]; finishReason: string }> {
        let content = '';
        const toolCalls: ToolCall[] = [];
        const toolCallsMap = new Map<number, ToolCall>();
        let finishReason = 'stop';

        for await (const chunk of this.createStreamingChatCompletion(messages, tools)) {
            for (const choice of chunk.choices) {
                if (choice.finish_reason) {
                    finishReason = choice.finish_reason;
                }

                const deltaContent = choice.delta.content;
                if (typeof deltaContent === 'string') {
                    content += deltaContent;
                    onChunk?.(deltaContent);
                }

                const deltaToolCalls = choice.delta.tool_calls as StreamDelta['tool_calls'];
                if (deltaToolCalls) {
                    for (const tc of deltaToolCalls) {
                        const index = tc.index ?? 0;
                        const existing = toolCallsMap.get(index);
                        if (existing) {
                            // Append to existing tool call
                            if (tc.function?.arguments) {
                                existing.function.arguments += tc.function.arguments;
                            }
                        } else if (tc.id) {
                            // New tool call
                            const newToolCall: ToolCall = {
                                id: tc.id,
                                type: 'function',
                                function: {
                                    name: tc.function?.name || '',
                                    arguments: tc.function?.arguments || '',
                                },
                            };
                            toolCallsMap.set(index, newToolCall);
                        }
                    }
                }
            }
        }

        // Convert map to array
        toolCalls.push(...toolCallsMap.values());

        if (toolCalls.length > 0) {
            onToolCalls?.(toolCalls);
        }

        return { content, toolCalls, finishReason };
    }

    /**
     * Send tool results back to the API
     */
    async sendToolResults(
        messages: Message[],
        toolResults: ToolResult[],
        tools?: ToolDefinition[],
        onChunk?: (content: string) => void,
        onToolCalls?: (toolCalls: ToolCall[]) => void
    ): Promise<{ content: string; toolCalls: ToolCall[]; finishReason: string }> {
        // Add tool results as messages
        const toolMessages: Message[] = toolResults.map((result) => ({
            role: 'tool' as const,
            tool_call_id: result.tool_call_id,
            content: result.content,
        }));

        const allMessages = [...messages, ...toolMessages];
        return this.streamChatCompletion(allMessages, tools, onChunk, onToolCalls);
    }

    private getHeaders(): Record<string, string> {
        const headers: Record<string, string> = {
            'Content-Type': 'application/json',
        };

        if (this.apiKey) {
            headers['Authorization'] = `Bearer ${this.apiKey}`;
        }

        return headers;
    }

    private async makeRequest<T>(endpoint: string, body: unknown): Promise<T> {
        const response = await this.fetchWithRetry(endpoint, {
            method: 'POST',
            headers: this.getHeaders(),
            body: JSON.stringify(body),
        });

        if (!response.ok) {
            const errorBody = await response.text();
            throw new APIError(`API request failed: ${response.status}`, response.status, errorBody);
        }

        return response.json() as Promise<T>;
    }

    private async fetchWithRetry(
        endpoint: string,
        options: RequestInit,
        retries = MAX_RETRIES
    ): Promise<Response> {
        const url = `${this.baseUrl}${endpoint}`;
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), this.timeout);

        try {
            const response = await fetch(url, {
                ...options,
                signal: controller.signal,
            });

            clearTimeout(timeoutId);

            // Retry on 5xx errors
            if (response.status >= 500 && retries > 0) {
                await this.delay(RETRY_DELAY_MS * (MAX_RETRIES - retries + 1));
                return this.fetchWithRetry(endpoint, options, retries - 1);
            }

            return response;
        } catch (error) {
            clearTimeout(timeoutId);

            if (retries > 0 && error instanceof Error && error.name !== 'AbortError') {
                await this.delay(RETRY_DELAY_MS * (MAX_RETRIES - retries + 1));
                return this.fetchWithRetry(endpoint, options, retries - 1);
            }

            throw new APIError(`Network error: ${error instanceof Error ? error.message : 'Unknown error'}`);
        }
    }

    private delay(ms: number): Promise<void> {
        return new Promise((resolve) => setTimeout(resolve, ms));
    }

    // Getters for current configuration
    get currentModel(): string {
        return this.model;
    }

    get currentBaseUrl(): string {
        return this.baseUrl;
    }
}

// Export singleton instance
export const apiClient = new APIClient();
