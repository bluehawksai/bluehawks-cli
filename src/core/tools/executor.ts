/**
 * Bluehawks CLI - Tool Executor
 * Executes tools with safety controls and output handling
 */

import { toolRegistry, type ToolHandler } from './registry.js';
import type { ToolCall, ToolResult } from '../api/types.js';
import { MAX_OUTPUT_LENGTH } from '../../config/constants.js';

export type ApprovalMode = 'always' | 'never' | 'unsafe-only';

export interface ExecutorOptions {
    approvalMode: ApprovalMode;
    onApprovalRequest?: (toolName: string, args: Record<string, unknown>) => Promise<boolean>;
    onToolStart?: (toolName: string, args: Record<string, unknown>) => void;
    onToolEnd?: (toolName: string, result: string, isError: boolean) => void;
}

export class ToolExecutor {
    private options: ExecutorOptions;

    constructor(options: Partial<ExecutorOptions> = {}) {
        this.options = {
            approvalMode: options.approvalMode || 'unsafe-only',
            onApprovalRequest: options.onApprovalRequest,
            onToolStart: options.onToolStart,
            onToolEnd: options.onToolEnd,
        };
    }

    async executeToolCalls(toolCalls: ToolCall[]): Promise<ToolResult[]> {
        const results: ToolResult[] = [];

        for (const toolCall of toolCalls) {
            const result = await this.executeToolCall(toolCall);
            results.push(result);
        }

        return results;
    }

    async executeToolCall(toolCall: ToolCall): Promise<ToolResult> {
        const { id, function: fn } = toolCall;
        const { name, arguments: argsString } = fn;

        let args: Record<string, unknown>;
        try {
            args = JSON.parse(argsString);
        } catch {
            return {
                tool_call_id: id,
                content: `Error: Failed to parse tool arguments: ${argsString}`,
                isError: true,
            };
        }

        const handler = toolRegistry.get(name);
        if (!handler) {
            return {
                tool_call_id: id,
                content: `Error: Unknown tool: ${name}`,
                isError: true,
            };
        }

        // Check if approval is needed
        const needsApproval = await this.needsApproval(handler);
        if (needsApproval) {
            const approved = await this.requestApproval(name, args);
            if (!approved) {
                return {
                    tool_call_id: id,
                    content: 'Tool execution was denied by the user.',
                    isError: true,
                };
            }
        }

        // Execute the tool
        this.options.onToolStart?.(name, args);

        try {
            let result = await handler.execute(args);

            // Truncate output if too long
            if (result.length > MAX_OUTPUT_LENGTH) {
                result = result.substring(0, MAX_OUTPUT_LENGTH) + '\n... (output truncated)';
            }

            this.options.onToolEnd?.(name, result, false);

            return {
                tool_call_id: id,
                content: result,
                isError: false,
            };
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            this.options.onToolEnd?.(name, errorMessage, true);

            return {
                tool_call_id: id,
                content: `Error: ${errorMessage}`,
                isError: true,
            };
        }
    }

    private async needsApproval(handler: ToolHandler): Promise<boolean> {
        switch (this.options.approvalMode) {
            case 'never':
                return false;
            case 'always':
                return true;
            case 'unsafe-only':
                return !handler.safeToAutoRun;
            default:
                return !handler.safeToAutoRun;
        }
    }

    private async requestApproval(
        toolName: string,
        args: Record<string, unknown>
    ): Promise<boolean> {
        if (!this.options.onApprovalRequest) {
            // If no approval handler, deny by default
            return false;
        }

        return this.options.onApprovalRequest(toolName, args);
    }

    setApprovalMode(mode: ApprovalMode): void {
        this.options.approvalMode = mode;
    }

    setApprovalHandler(
        handler: (toolName: string, args: Record<string, unknown>) => Promise<boolean>
    ): void {
        this.options.onApprovalRequest = handler;
    }
}

export const toolExecutor = new ToolExecutor();
