/**
 * Bluehawks CLI - MCP Manager
 * Manages MCP server connections and integrates tools
 */

import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';
import { MCPClient, type MCPServerConfig, type MCPTool } from './client.js';
import { toolRegistry } from '../tools/index.js';
import type { ToolDefinition } from '../api/types.js';

export interface MCPConfig {
    mcpServers?: Record<string, MCPServerConfig>;
}

export class MCPManager {
    private clients: Map<string, MCPClient> = new Map();

    constructor() {
        // Manager initialized - config will be loaded on connectAll
    }

    /**
     * Load MCP configuration from file
     */
    async loadConfig(): Promise<MCPConfig | null> {
        const paths = [
            path.join(process.cwd(), '.mcp.json'),
            path.join(os.homedir(), '.bluehawks', '.mcp.json'),
        ];

        for (const configPath of paths) {
            try {
                const content = await fs.readFile(configPath, 'utf-8');
                return JSON.parse(content) as MCPConfig;
            } catch {
                continue;
            }
        }
        return null;
    }

    /**
     * Connect to all configured MCP servers
     */
    async connectAll(): Promise<void> {
        const config = await this.loadConfig();
        if (!config?.mcpServers) {
            return;
        }

        for (const [name, serverConfig] of Object.entries(config.mcpServers)) {
            try {
                await this.connect(name, serverConfig);
            } catch (error) {
                console.error(`Failed to connect to MCP server ${name}:`, error);
            }
        }
    }

    /**
     * Connect to a specific MCP server
     */
    async connect(name: string, config: MCPServerConfig): Promise<MCPClient> {
        const client = new MCPClient(name);
        await client.connect(config);

        // List and register tools
        const tools = await client.listTools();
        for (const tool of tools) {
            this.registerMCPTool(name, tool);
        }

        this.clients.set(name, client);
        return client;
    }

    /**
     * Register an MCP tool as a Bluehawks tool
     */
    private registerMCPTool(serverName: string, mcpTool: MCPTool): void {
        const toolName = `mcp_${serverName}_${mcpTool.name}`;

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const definition: ToolDefinition = {
            type: 'function',
            function: {
                name: toolName,
                description: `[MCP:${serverName}] ${mcpTool.description}`,
                parameters: mcpTool.inputSchema as ToolDefinition['function']['parameters'],
            },
        };


        const clients = this.clients;
        toolRegistry.register({
            name: toolName,
            definition,
            execute: async (args: Record<string, unknown>) => {
                const client = clients.get(serverName);
                if (!client) {
                    return `MCP server ${serverName} not connected`;
                }
                try {
                    const result = await client.callTool(mcpTool.name, args);
                    return typeof result === 'string' ? result : JSON.stringify(result, null, 2);
                } catch (error) {
                    return `MCP tool error: ${error instanceof Error ? error.message : String(error)}`;
                }
            },
            safeToAutoRun: false, // MCP tools require approval by default
        });
    }

    /**
     * Get all connected clients
     */
    getClients(): Map<string, MCPClient> {
        return this.clients;
    }

    /**
     * Get a specific client
     */
    getClient(name: string): MCPClient | undefined {
        return this.clients.get(name);
    }

    /**
     * Disconnect all MCP servers
     */
    async disconnectAll(): Promise<void> {
        for (const client of this.clients.values()) {
            await client.disconnect();
        }
        this.clients.clear();
    }

    /**
     * Disconnect a specific server
     */
    async disconnect(name: string): Promise<void> {
        const client = this.clients.get(name);
        if (client) {
            await client.disconnect();
            this.clients.delete(name);
        }
    }
}

// Singleton instance
export const mcpManager = new MCPManager();
