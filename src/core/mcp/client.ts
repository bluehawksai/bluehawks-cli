/**
 * Bluehawks CLI - MCP Client
 * Model Context Protocol client for connecting to external data sources
 */

import { spawn, type ChildProcess } from 'node:child_process';
import * as readline from 'node:readline';

export interface MCPServerConfig {
    command: string;
    args?: string[];
    env?: Record<string, string>;
}

export interface MCPTool {
    name: string;
    description: string;
    inputSchema: {
        type: string;
        properties?: Record<string, unknown>;
        required?: string[];
    };
}

export interface MCPResource {
    uri: string;
    name: string;
    description?: string;
    mimeType?: string;
}

interface JsonRpcRequest {
    jsonrpc: '2.0';
    id: number;
    method: string;
    params?: Record<string, unknown>;
}

interface JsonRpcResponse {
    jsonrpc: '2.0';
    id: number;
    result?: unknown;
    error?: { code: number; message: string };
}

export class MCPClient {
    private serverName: string;
    private process: ChildProcess | null = null;
    private requestId = 0;
    private pendingRequests = new Map<number, {
        resolve: (value: unknown) => void;
        reject: (error: Error) => void;
    }>();
    private tools: MCPTool[] = [];
    private resources: MCPResource[] = [];
    private reader: readline.Interface | null = null;

    constructor(serverName: string) {
        this.serverName = serverName;
    }

    async connect(config: MCPServerConfig): Promise<void> {
        return new Promise((resolve, reject) => {
            this.process = spawn(config.command, config.args || [], {
                stdio: ['pipe', 'pipe', 'pipe'],
                env: { ...process.env, ...config.env },
            });

            if (!this.process.stdout || !this.process.stdin) {
                reject(new Error('Failed to create MCP process'));
                return;
            }

            this.reader = readline.createInterface({
                input: this.process.stdout,
            });

            this.reader.on('line', (line) => {
                try {
                    const response = JSON.parse(line) as JsonRpcResponse;
                    const pending = this.pendingRequests.get(response.id);
                    if (pending) {
                        this.pendingRequests.delete(response.id);
                        if (response.error) {
                            pending.reject(new Error(response.error.message));
                        } else {
                            pending.resolve(response.result);
                        }
                    }
                } catch {
                    // Ignore non-JSON output
                }
            });

            this.process.on('error', (err) => {
                reject(err);
            });

            // Initialize the MCP connection
            this.sendRequest('initialize', {
                protocolVersion: '2024-11-05',
                capabilities: {},
                clientInfo: { name: 'bluehawks-cli', version: '1.0.0' },
            }).then(() => {
                // Send initialized notification
                this.sendNotification('notifications/initialized');
                resolve();
            }).catch(reject);
        });
    }

    private sendRequest(method: string, params?: Record<string, unknown>): Promise<unknown> {
        return new Promise((resolve, reject) => {
            if (!this.process?.stdin) {
                reject(new Error('MCP process not connected'));
                return;
            }

            const id = ++this.requestId;
            const request: JsonRpcRequest = {
                jsonrpc: '2.0',
                id,
                method,
                params,
            };

            this.pendingRequests.set(id, { resolve, reject });
            this.process.stdin.write(JSON.stringify(request) + '\n');

            // Timeout after 30 seconds
            setTimeout(() => {
                if (this.pendingRequests.has(id)) {
                    this.pendingRequests.delete(id);
                    reject(new Error(`Request ${method} timed out`));
                }
            }, 30000);
        });
    }

    private sendNotification(method: string, params?: Record<string, unknown>): void {
        if (!this.process?.stdin) return;

        const notification = {
            jsonrpc: '2.0',
            method,
            params,
        };
        this.process.stdin.write(JSON.stringify(notification) + '\n');
    }

    async listTools(): Promise<MCPTool[]> {
        const result = await this.sendRequest('tools/list') as { tools: MCPTool[] };
        this.tools = result.tools || [];
        return this.tools;
    }

    async listResources(): Promise<MCPResource[]> {
        const result = await this.sendRequest('resources/list') as { resources: MCPResource[] };
        this.resources = result.resources || [];
        return this.resources;
    }

    async callTool(name: string, args: Record<string, unknown>): Promise<unknown> {
        const result = await this.sendRequest('tools/call', {
            name,
            arguments: args,
        });
        return result;
    }

    async readResource(uri: string): Promise<{ contents: unknown[] }> {
        const result = await this.sendRequest('resources/read', { uri });
        return result as { contents: unknown[] };
    }

    getTools(): MCPTool[] {
        return this.tools;
    }

    getResources(): MCPResource[] {
        return this.resources;
    }

    getServerName(): string {
        return this.serverName;
    }

    async disconnect(): Promise<void> {
        if (this.reader) {
            this.reader.close();
        }
        if (this.process) {
            this.process.kill();
            this.process = null;
        }
        this.pendingRequests.clear();
    }
}
