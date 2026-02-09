/**
 * Bluehawks CLI - Hooks Manager
 * Central registry for hook handlers
 */

import { spawn } from 'node:child_process';
import type {
    HookEvent,
    HookHandler,
    HookInput,
    HookOutput,
    HooksConfig,
} from './types.js';

export class HooksManager {
    private handlers: Map<HookEvent, HookHandler[]> = new Map();

    constructor() {
        // Initialize empty handler arrays for each event
        const events: HookEvent[] = [
            'SessionStart',
            'UserPromptSubmit',
            'PreToolUse',
            'PostToolUse',
            'PostToolUseFailure',
            'Stop',
            'SessionEnd',
        ];
        for (const event of events) {
            this.handlers.set(event, []);
        }
    }

    /**
     * Register a hook handler
     */
    register(handler: HookHandler): void {
        const handlers = this.handlers.get(handler.event) || [];
        handlers.push(handler);
        this.handlers.set(handler.event, handlers);
    }

    /**
     * Register multiple handlers from config
     */
    registerFromConfig(config: HooksConfig): void {
        for (const [event, handlers] of Object.entries(config)) {
            for (const handler of handlers || []) {
                this.register({
                    ...handler,
                    event: event as HookEvent,
                    id: handler.id || `${event}-${Date.now()}`,
                    name: handler.name || handler.command || 'anonymous',
                });
            }
        }
    }

    /**
     * Unregister a hook handler by ID
     */
    unregister(handlerId: string): boolean {
        for (const [event, handlers] of this.handlers) {
            const index = handlers.findIndex((h) => h.id === handlerId);
            if (index !== -1) {
                handlers.splice(index, 1);
                this.handlers.set(event, handlers);
                return true;
            }
        }
        return false;
    }

    /**
     * Execute all handlers for an event
     */
    async execute(event: HookEvent, input: HookInput): Promise<HookOutput[]> {
        const handlers = this.handlers.get(event) || [];
        const results: HookOutput[] = [];

        for (const handler of handlers) {
            // Check matcher if present
            if (handler.matcher && 'toolName' in input) {
                const pattern = typeof handler.matcher === 'string'
                    ? new RegExp(handler.matcher)
                    : handler.matcher;
                if (!pattern.test(input.toolName)) {
                    continue;
                }
            }

            try {
                const result = await this.executeHandler(handler, input);
                if (result) {
                    results.push(result);
                    // Stop processing if handler blocks
                    if (result.block) {
                        break;
                    }
                }
            } catch (error) {
                console.error(`Hook error (${handler.name}):`, error);
            }
        }

        return results;
    }

    /**
     * Execute a single handler
     */
    private async executeHandler(
        handler: HookHandler,
        input: HookInput
    ): Promise<HookOutput | void> {
        const timeout = handler.timeout || 30000;

        // If handler has inline function
        if (handler.handler) {
            return Promise.race([
                handler.handler(input),
                new Promise<void>((_, reject) =>
                    setTimeout(() => reject(new Error('Hook timeout')), timeout)
                ),
            ]);
        }

        // If handler has command
        if (handler.command) {
            return this.executeCommand(handler.command, input, timeout);
        }

        return undefined;
    }

    /**
     * Execute a shell command hook
     */
    private executeCommand(
        command: string,
        input: HookInput,
        timeout: number
    ): Promise<HookOutput | void> {
        return new Promise((resolve, reject) => {
            const proc = spawn('sh', ['-c', command], {
                env: {
                    ...process.env,
                    HOOK_INPUT: JSON.stringify(input),
                },
                timeout,
            });

            let stdout = '';
            let stderr = '';

            proc.stdout.on('data', (data) => {
                stdout += data.toString();
            });

            proc.stderr.on('data', (data) => {
                stderr += data.toString();
            });

            proc.on('close', (code) => {
                if (code !== 0) {
                    // Non-zero exit = block action
                    resolve({
                        block: true,
                        blockReason: stderr || `Hook exited with code ${code}`,
                    });
                } else {
                    // Try to parse JSON output
                    try {
                        if (stdout.trim()) {
                            resolve(JSON.parse(stdout) as HookOutput);
                        } else {
                            resolve(undefined);
                        }
                    } catch {
                        resolve(undefined);
                    }
                }
            });

            proc.on('error', (err) => {
                reject(err);
            });
        });
    }

    /**
     * Get all registered handlers
     */
    getHandlers(event?: HookEvent): HookHandler[] {
        if (event) {
            return this.handlers.get(event) || [];
        }
        return Array.from(this.handlers.values()).flat();
    }

    /**
     * Clear all handlers
     */
    clear(): void {
        for (const event of this.handlers.keys()) {
            this.handlers.set(event, []);
        }
    }
}

// Singleton instance
export const hooksManager = new HooksManager();
