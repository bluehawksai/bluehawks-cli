/**
 * Bluehawks CLI - API Types
 * OpenAI-compatible API type definitions
 */

// Message Types
export type MessageRole = 'system' | 'user' | 'assistant' | 'tool';

export interface Message {
    role: MessageRole;
    content: string | ContentPart[];
    name?: string;
    tool_calls?: ToolCall[];
    tool_call_id?: string;
}

export interface ContentPart {
    type: 'text' | 'image_url';
    text?: string;
    image_url?: {
        url: string;
        detail?: 'auto' | 'low' | 'high';
    };
}

// Tool Types
export interface ToolCall {
    id: string;
    type: 'function';
    function: {
        name: string;
        arguments: string;
    };
}

export interface ToolDefinition {
    type: 'function';
    function: {
        name: string;
        description: string;
        parameters: {
            type: 'object';
            properties: Record<string, ToolParameterSchema>;
            required?: string[];
        };
    };
}

export interface ToolParameterSchema {
    type: string;
    description?: string;
    enum?: string[];
    items?: ToolParameterSchema;
    properties?: Record<string, ToolParameterSchema>;
    required?: string[];
}

export interface ToolResult {
    tool_call_id: string;
    content: string;
    isError?: boolean;
}

// API Request/Response Types
export interface ChatCompletionRequest {
    model: string;
    messages: Message[];
    tools?: ToolDefinition[];
    tool_choice?: 'auto' | 'none' | 'required' | { type: 'function'; function: { name: string } };
    max_tokens?: number;
    temperature?: number;
    stream?: boolean;
    stop?: string[];
}

export interface ChatCompletionResponse {
    id: string;
    object: 'chat.completion';
    created: number;
    model: string;
    choices: Choice[];
    usage?: Usage;
}

export interface Choice {
    index: number;
    message: Message;
    finish_reason: 'stop' | 'length' | 'tool_calls' | 'content_filter' | null;
}

export interface Usage {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
}

// Streaming Types
export interface StreamDelta {
    content?: string;
    tool_calls?: Array<{
        index?: number;
        id?: string;
        type?: 'function';
        function?: {
            name?: string;
            arguments?: string;
        };
    }>;
}

export interface ChatCompletionChunk {
    id: string;
    object: 'chat.completion.chunk';
    created: number;
    model: string;
    choices: StreamChoice[];
}

export interface StreamChoice {
    index: number;
    delta: StreamDelta;
    finish_reason: string | null;
}

// API Client Options
export interface APIClientOptions {
    baseUrl?: string;
    apiKey?: string;
    model?: string;
    maxTokens?: number;
    temperature?: number;
    timeout?: number;
}

// Streaming callback types
export type StreamCallback = (chunk: string) => void;
export type ToolCallCallback = (toolCalls: ToolCall[]) => void;

// API Error
export class APIError extends Error {
    constructor(
        message: string,
        public statusCode?: number,
        public response?: unknown
    ) {
        super(message);
        this.name = 'APIError';
    }
}
