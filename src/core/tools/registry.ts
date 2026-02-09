/**
 * Bluehawks CLI - Tool Registry
 * Central registry for all available tools
 */

import type { ToolDefinition } from '../api/types.js';

export interface ToolHandler {
    name: string;
    definition: ToolDefinition;
    execute: (args: Record<string, unknown>) => Promise<string>;
    safeToAutoRun: boolean;
}

class ToolRegistry {
    private tools: Map<string, ToolHandler> = new Map();

    register(handler: ToolHandler): void {
        this.tools.set(handler.name, handler);
    }

    get(name: string): ToolHandler | undefined {
        return this.tools.get(name);
    }

    getAll(): ToolHandler[] {
        return Array.from(this.tools.values());
    }

    getDefinitions(): ToolDefinition[] {
        return this.getAll().map((handler) => handler.definition);
    }

    has(name: string): boolean {
        return this.tools.has(name);
    }

    isSafeToAutoRun(name: string): boolean {
        const handler = this.tools.get(name);
        return handler?.safeToAutoRun ?? false;
    }
}

export const toolRegistry = new ToolRegistry();
