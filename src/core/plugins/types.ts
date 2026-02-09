/**
 * Bluehawks CLI - Plugin Types
 * Type definitions for the plugin system
 */

import type { ToolDefinition } from '../api/types.js';
import type { HookHandler } from '../hooks/types.js';

/**
 * Plugin manifest (plugin.json)
 */
export interface PluginManifest {
    name: string;
    version: string;
    description?: string;
    author?: string;
    main?: string;  // Entry point for JS plugins
    commands?: PluginCommand[];
    tools?: PluginTool[];
    hooks?: PluginHook[];
    agents?: PluginAgent[];
}

/**
 * Custom slash command definition
 */
export interface PluginCommand {
    name: string;
    description: string;
    aliases?: string[];
    handler?: string;  // Path to handler file
}

/**
 * Custom tool definition
 */
export interface PluginTool {
    name: string;
    description: string;
    parameters: ToolDefinition['function']['parameters'];
    handler: string;  // Path to handler file
    safeToAutoRun?: boolean;
}

/**
 * Hook configuration
 */
export interface PluginHook {
    event: string;
    command?: string;
    handler?: string;  // Path to handler file
    matcher?: string;
    async?: boolean;
    timeout?: number;
}

/**
 * Custom agent definition
 */
export interface PluginAgent {
    name: string;
    description: string;
    systemPrompt: string;
    tools?: string[];
    maxIterations?: number;
}

/**
 * Loaded plugin instance
 */
export interface LoadedPlugin {
    manifest: PluginManifest;
    path: string;
    commands: Map<string, PluginCommandHandler>;
    tools: Map<string, PluginToolHandler>;
    hooks: HookHandler[];
    agents: Map<string, PluginAgent>;
}

/**
 * Command handler function
 */
export type PluginCommandHandler = (
    args: string[],
    context: PluginContext
) => Promise<string | void>;

/**
 * Tool handler function
 */
export type PluginToolHandler = (
    args: Record<string, unknown>,
    context: PluginContext
) => Promise<string>;

/**
 * Context passed to plugin handlers
 */
export interface PluginContext {
    projectPath: string;
    sessionId: string;
    model: string;
}

/**
 * Plugin discovery result
 */
export interface PluginDiscovery {
    path: string;
    manifest: PluginManifest;
}
