/**
 * Bluehawks CLI - Base Agent
 * Base class for all agents
 */

import { APIClient } from '../api/client.js';
import { toolRegistry } from '../tools/registry.js';
import { ToolExecutor } from '../tools/executor.js';
import type { Message, ToolResult, ToolDefinition } from '../api/types.js';
import { hooksManager } from '../hooks/index.js';
import type { PreToolUseInput, PostToolUseInput, PostToolUseFailureInput } from '../hooks/types.js';

export interface AgentOptions {
    name: string;
    systemPrompt: string;
    tools?: string[];
    maxIterations?: number;
}

export interface AgentResponse {
    content: string;
    toolsUsed: string[];
    iterations: number;
}

export class Agent {
    protected name: string;
    protected systemPrompt: string;
    protected tools: ToolDefinition[];
    protected maxIterations: number;
    protected apiClient: APIClient;
    protected toolExecutor: ToolExecutor;
    protected messages: Message[];
    protected sessionId: string;

    constructor(options: AgentOptions, apiClient: APIClient, toolExecutor: ToolExecutor) {
        this.name = options.name;
        this.systemPrompt = options.systemPrompt;
        this.maxIterations = options.maxIterations || 10;
        this.apiClient = apiClient;
        this.toolExecutor = toolExecutor;
        this.messages = [];
        this.sessionId = `session_${Date.now()}`;

        // Get tool definitions
        if (options.tools && options.tools.length > 0) {
            this.tools = options.tools
                .map((name) => toolRegistry.get(name)?.definition)
                .filter((def): def is ToolDefinition => def !== undefined);
        } else {
            this.tools = toolRegistry.getDefinitions();
        }
    }

    async run(
        userMessage: string,
        onChunk?: (content: string) => void,
        onToolStart?: (name: string) => void,
        onToolEnd?: (name: string, result: string) => void
    ): Promise<AgentResponse> {
        // Initialize with system message
        this.messages = [
            { role: 'system', content: this.systemPrompt },
            { role: 'user', content: userMessage },
        ];

        const toolsUsed: string[] = [];
        let iterations = 0;
        let finalContent = '';

        while (iterations < this.maxIterations) {
            iterations++;

            // Use non-streaming with tools for agent loop (vLLM doesn't support streaming + tool_choice)
            const response = await this.apiClient.createChatCompletion(
                this.messages,
                this.tools,
                'auto'
            );

            const choice = response.choices[0];
            const message = choice.message;

            // Add assistant message
            const assistantMessage: Message = {
                role: 'assistant',
                content: message.content || '',
            };
            if (message.tool_calls && message.tool_calls.length > 0) {
                assistantMessage.tool_calls = message.tool_calls;
            }
            this.messages.push(assistantMessage);

            // If no tool calls, we're done - output the response
            if (!message.tool_calls || message.tool_calls.length === 0) {
                let content = typeof message.content === 'string' ? message.content : '';

                // Filter out <think> tags for models that output reasoning
                content = content.replace(/<think>[\s\S]*?<\/think>/g, '').trim();

                finalContent = content;
                // Simulate streaming by outputting content progressively
                if (onChunk && finalContent) {
                    // Output in small chunks for streaming effect
                    const words = finalContent.split(' ');
                    for (const word of words) {
                        onChunk(word + ' ');
                        await new Promise(r => setTimeout(r, 20)); // Small delay for streaming effect
                    }
                }
                break;
            }

            // Execute tool calls
            const toolResults: ToolResult[] = [];
            for (const toolCall of message.tool_calls) {
                const toolName = toolCall.function.name;
                const toolInput = JSON.parse(toolCall.function.arguments || '{}');
                toolsUsed.push(toolName);

                // Execute PreToolUse hooks
                const hookContext = {
                    sessionId: this.sessionId,
                    projectPath: process.cwd(),
                    model: this.apiClient.currentModel,
                    timestamp: new Date().toISOString(),
                };

                const preHookInput: PreToolUseInput = {
                    ...hookContext,
                    toolName,
                    toolInput,
                };

                const preResults = await hooksManager.execute('PreToolUse', preHookInput);

                // Check if any hook blocked the tool
                const blocked = preResults.find(r => r.block);
                if (blocked) {
                    toolResults.push({
                        tool_call_id: toolCall.id,
                        content: `Tool blocked by hook: ${blocked.blockReason || 'No reason provided'}`,
                    });
                    continue;
                }

                onToolStart?.(toolName);
                const startTime = Date.now();

                try {
                    const result = await this.toolExecutor.executeToolCall(toolCall);
                    const duration = Date.now() - startTime;
                    toolResults.push(result);

                    // Execute PostToolUse hooks
                    const postHookInput: PostToolUseInput = {
                        ...hookContext,
                        toolName,
                        toolInput,
                        toolOutput: result.content,
                        duration,
                    };
                    await hooksManager.execute('PostToolUse', postHookInput);

                    onToolEnd?.(toolName, result.content);
                } catch (error) {
                    // Execute PostToolUseFailure hooks
                    const failureHookInput: PostToolUseFailureInput = {
                        ...hookContext,
                        toolName,
                        toolInput,
                        error: error instanceof Error ? error.message : String(error),
                    };
                    await hooksManager.execute('PostToolUseFailure', failureHookInput);

                    toolResults.push({
                        tool_call_id: toolCall.id,
                        content: `Error: ${error instanceof Error ? error.message : String(error)}`,
                    });
                    onToolEnd?.(toolName, 'Error');
                }
            }


            // Add tool results to messages
            for (const result of toolResults) {
                this.messages.push({
                    role: 'tool',
                    tool_call_id: result.tool_call_id,
                    content: result.content,
                });
            }
        }

        return {
            content: finalContent,
            toolsUsed,
            iterations,
        };
    }

    getMessages(): Message[] {
        return [...this.messages];
    }

    getName(): string {
        return this.name;
    }
}
