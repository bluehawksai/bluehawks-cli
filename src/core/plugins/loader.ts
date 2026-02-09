/**
 * Bluehawks CLI - Plugin Loader
 * Discovers and loads plugins from plugin directories
 */

import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';
import { pathToFileURL } from 'node:url';
import type {
    PluginManifest,
    LoadedPlugin,
    PluginDiscovery,
    PluginCommandHandler,
    PluginToolHandler,
    PluginContext,
} from './types.js';
import { toolRegistry } from '../tools/index.js';
import { hooksManager } from '../hooks/index.js';
import type { ToolDefinition } from '../api/types.js';

// Plugin directories to search
const PLUGIN_DIRS = [
    path.join(os.homedir(), '.bluehawks', 'plugins'),
    path.join(process.cwd(), '.bluehawks', 'plugins'),
];

export class PluginLoader {
    private plugins: Map<string, LoadedPlugin> = new Map();
    private commandHandlers: Map<string, PluginCommandHandler> = new Map();

    /**
     * Discover all plugins in plugin directories
     */
    async discover(): Promise<PluginDiscovery[]> {
        const discoveries: PluginDiscovery[] = [];

        for (const pluginDir of PLUGIN_DIRS) {
            try {
                const entries = await fs.readdir(pluginDir, { withFileTypes: true });

                for (const entry of entries) {
                    if (!entry.isDirectory()) continue;

                    const pluginPath = path.join(pluginDir, entry.name);
                    const manifestPath = path.join(pluginPath, 'plugin.json');

                    try {
                        const manifestContent = await fs.readFile(manifestPath, 'utf-8');
                        const manifest = JSON.parse(manifestContent) as PluginManifest;
                        discoveries.push({ path: pluginPath, manifest });
                    } catch {
                        // No valid manifest, skip
                    }
                }
            } catch {
                // Directory doesn't exist, skip
            }
        }

        return discoveries;
    }

    /**
     * Load all discovered plugins
     */
    async loadAll(): Promise<void> {
        const discoveries = await this.discover();

        for (const discovery of discoveries) {
            try {
                await this.load(discovery);
            } catch (error) {
                console.error(`Failed to load plugin ${discovery.manifest.name}:`, error);
            }
        }
    }

    /**
     * Load a single plugin
     */
    async load(discovery: PluginDiscovery): Promise<LoadedPlugin> {
        const { manifest, path: pluginPath } = discovery;

        const loaded: LoadedPlugin = {
            manifest,
            path: pluginPath,
            commands: new Map(),
            tools: new Map(),
            hooks: [],
            agents: new Map(),
        };

        // Load commands
        if (manifest.commands) {
            for (const cmd of manifest.commands) {
                const handler = await this.loadCommandHandler(pluginPath, cmd.handler);
                if (handler) {
                    loaded.commands.set(cmd.name, handler);
                    this.commandHandlers.set(`/${cmd.name}`, handler);

                    // Register aliases
                    if (cmd.aliases) {
                        for (const alias of cmd.aliases) {
                            this.commandHandlers.set(`/${alias}`, handler);
                        }
                    }
                }
            }
        }

        // Load tools
        if (manifest.tools) {
            for (const tool of manifest.tools) {
                const handler = await this.loadToolHandler(pluginPath, tool.handler);
                if (handler) {
                    loaded.tools.set(tool.name, handler);
                    this.registerPluginTool(tool.name, tool.description, tool.parameters, handler, tool.safeToAutoRun);
                }
            }
        }

        // Load hooks
        if (manifest.hooks) {
            for (const hook of manifest.hooks) {
                const hookHandler = await this.createHookHandler(pluginPath, hook, manifest.name);
                loaded.hooks.push(hookHandler);
                hooksManager.register(hookHandler);
            }
        }

        // Load agents
        if (manifest.agents) {
            for (const agent of manifest.agents) {
                loaded.agents.set(agent.name, agent);
            }
        }

        this.plugins.set(manifest.name, loaded);
        return loaded;
    }

    /**
     * Load a command handler from file
     */
    private async loadCommandHandler(
        pluginPath: string,
        handlerPath?: string
    ): Promise<PluginCommandHandler | null> {
        if (!handlerPath) return null;

        try {
            const fullPath = path.join(pluginPath, handlerPath);
            const module = await import(pathToFileURL(fullPath).href);
            return module.default || module.handler;
        } catch {
            return null;
        }
    }

    /**
     * Load a tool handler from file
     */
    private async loadToolHandler(
        pluginPath: string,
        handlerPath: string
    ): Promise<PluginToolHandler | null> {
        try {
            const fullPath = path.join(pluginPath, handlerPath);
            const module = await import(pathToFileURL(fullPath).href);
            return module.default || module.handler;
        } catch {
            return null;
        }
    }

    /**
     * Create a hook handler from plugin config
     */
    private async createHookHandler(
        pluginPath: string,
        hook: import('./types.js').PluginHook,
        pluginName: string
    ) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const hookHandler: any = {
            id: `${pluginName}-${hook.event}-${Date.now()}`,
            name: `${pluginName}:${hook.event}`,
            event: hook.event,
            async: hook.async,
            timeout: hook.timeout,
        };

        if (hook.matcher) {
            hookHandler.matcher = new RegExp(hook.matcher);
        }

        if (hook.command) {
            hookHandler.command = hook.command;
        } else if (hook.handler) {
            try {
                const fullPath = path.join(pluginPath, hook.handler);
                const module = await import(pathToFileURL(fullPath).href);
                hookHandler.handler = module.default || module.handler;
            } catch {
                // Handler load failed
            }
        }

        return hookHandler;
    }

    /**
     * Register a plugin tool with the tool registry
     */
    private registerPluginTool(
        name: string,
        description: string,
        parameters: ToolDefinition['function']['parameters'],
        handler: PluginToolHandler,
        safeToAutoRun = false
    ): void {
        const definition: ToolDefinition = {
            type: 'function',
            function: {
                name: `plugin_${name}`,
                description: `[Plugin] ${description}`,
                parameters,
            },
        };

        toolRegistry.register({
            name: `plugin_${name}`,
            definition,
            execute: async (args: Record<string, unknown>) => {
                const context: PluginContext = {
                    projectPath: process.cwd(),
                    sessionId: `session_${Date.now()}`,
                    model: process.env.BLUEHAWKS_MODEL || 'unknown',
                };
                return handler(args, context);
            },
            safeToAutoRun,
        });
    }

    /**
     * Execute a plugin command
     */
    async executeCommand(
        commandName: string,
        args: string[],
        context: PluginContext
    ): Promise<string | null> {
        const handler = this.commandHandlers.get(commandName);
        if (!handler) return null;

        const result = await handler(args, context);
        return result || '';
    }

    /**
     * Check if a command is a plugin command
     */
    hasCommand(commandName: string): boolean {
        return this.commandHandlers.has(commandName);
    }

    /**
     * Get all loaded plugins
     */
    getPlugins(): LoadedPlugin[] {
        return Array.from(this.plugins.values());
    }

    /**
     * Get a specific plugin
     */
    getPlugin(name: string): LoadedPlugin | undefined {
        return this.plugins.get(name);
    }

    /**
     * Get all plugin agents
     */
    getAgents(): Map<string, LoadedPlugin['agents']> {
        const allAgents = new Map<string, LoadedPlugin['agents']>();
        for (const [name, plugin] of this.plugins) {
            if (plugin.agents.size > 0) {
                allAgents.set(name, plugin.agents);
            }
        }
        return allAgents;
    }

    /**
     * Unload all plugins
     */
    unloadAll(): void {
        for (const plugin of this.plugins.values()) {
            // Remove hooks
            for (const hook of plugin.hooks) {
                hooksManager.unregister(hook.id);
            }
        }
        this.plugins.clear();
        this.commandHandlers.clear();
    }
}

// Singleton instance
export const pluginLoader = new PluginLoader();
