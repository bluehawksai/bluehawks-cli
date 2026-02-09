/**
 * Bluehawks CLI - Session Manager
 * Manages conversation history and session state
 */

import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import type { Message, Usage } from '../api/types.js';
import { CONFIG_DIR_NAME, HISTORY_FILE, MAX_HISTORY_MESSAGES } from '../../config/constants.js';

export interface Session {
    id: string;
    startTime: Date;
    messages: Message[];
    metadata: {
        projectPath: string;
        model: string;
        tokensUsed: number;
        toolsUsed: string[];
        successfulToolCalls: number;
        failedToolCalls: number;
        apiTime: number;
        toolTime: number;
        modelUsage: Record<string, {
            inputTokens: number;
            outputTokens: number;
            cacheReadTokens: number;
            totalTokens: number;
        }>;
    };
}

export interface SessionStats {
    messageCount: number;
    userMessages: number;
    assistantMessages: number;
    toolMessages: number;
    tokensUsed: number;
    toolsUsed: string[];
    successfulToolCalls: number;
    failedToolCalls: number;
    apiTime: number;
    toolTime: number;
    duration: number;
    modelUsage: Record<string, {
        inputTokens: number;
        outputTokens: number;
        cacheReadTokens: number;
        totalTokens: number;
    }>;
}

export class SessionManager {
    private session: Session;
    private configDir: string;

    constructor(projectPath: string, model: string) {
        this.configDir = path.join(projectPath, CONFIG_DIR_NAME);
        this.session = {
            id: this.generateSessionId(),
            startTime: new Date(),
            messages: [],
            metadata: {
                projectPath,
                model,
                tokensUsed: 0,
                toolsUsed: [],
                successfulToolCalls: 0,
                failedToolCalls: 0,
                apiTime: 0,
                toolTime: 0,
                modelUsage: {},
            },
        };
    }

    private generateSessionId(): string {
        return `session_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;
    }

    addMessage(message: Message): void {
        this.session.messages.push(message);

        // Limit history size
        if (this.session.messages.length > MAX_HISTORY_MESSAGES) {
            this.compressHistory();
        }
    }

    addMessages(messages: Message[]): void {
        for (const message of messages) {
            this.addMessage(message);
        }
    }

    addToolUsed(toolName: string): void {
        if (!this.session.metadata.toolsUsed.includes(toolName)) {
            this.session.metadata.toolsUsed.push(toolName);
        }
    }

    addTokensUsed(tokens: number): void {
        this.session.metadata.tokensUsed += tokens;
    }

    addApiTime(ms: number): void {
        this.session.metadata.apiTime += ms;
    }

    addToolTime(ms: number): void {
        this.session.metadata.toolTime += ms;
    }

    addUsage(model: string, usage: Usage): void {
        // Update total tokens
        this.session.metadata.tokensUsed += usage.total_tokens || 0;

        // Update per-model usage
        if (!this.session.metadata.modelUsage) {
            this.session.metadata.modelUsage = {};
        }

        if (!this.session.metadata.modelUsage[model]) {
            this.session.metadata.modelUsage[model] = {
                inputTokens: 0,
                outputTokens: 0,
                cacheReadTokens: 0,
                totalTokens: 0,
            };
        }

        const modelStats = this.session.metadata.modelUsage[model];
        modelStats.inputTokens += usage.prompt_tokens || 0;
        modelStats.outputTokens += usage.completion_tokens || 0;
        modelStats.totalTokens += usage.total_tokens || 0;

        if (usage.prompt_tokens_details?.cached_tokens) {
            modelStats.cacheReadTokens += usage.prompt_tokens_details.cached_tokens;
        }
    }

    recordToolCall(success: boolean): void {
        if (success) {
            this.session.metadata.successfulToolCalls++;
        } else {
            this.session.metadata.failedToolCalls++;
        }
    }

    getMessages(): Message[] {
        return [...this.session.messages];
    }

    getStats(): SessionStats {
        const messages = this.session.messages;
        const duration = Date.now() - this.session.startTime.getTime();

        return {
            messageCount: messages.length,
            userMessages: messages.filter((m) => m.role === 'user').length,
            assistantMessages: messages.filter((m) => m.role === 'assistant').length,
            toolMessages: messages.filter((m) => m.role === 'tool').length,
            tokensUsed: this.session.metadata.tokensUsed,
            toolsUsed: [...this.session.metadata.toolsUsed],
            successfulToolCalls: this.session.metadata.successfulToolCalls,
            failedToolCalls: this.session.metadata.failedToolCalls,
            apiTime: this.session.metadata.apiTime,
            toolTime: this.session.metadata.toolTime,
            modelUsage: this.session.metadata.modelUsage || {},
            duration,
        };
    }

    clear(): void {
        this.session.messages = [];
        this.session.metadata.tokensUsed = 0;
        this.session.metadata.toolsUsed = [];
    }

    compressHistory(): void {
        // Keep system message and recent messages
        const systemMessage = this.session.messages.find((m) => m.role === 'system');
        const recentMessages = this.session.messages.slice(-20);

        // Create a summary of older messages
        const olderMessages = this.session.messages.slice(
            systemMessage ? 1 : 0,
            -20
        );

        if (olderMessages.length > 0) {
            const summaryContent = `[Previous conversation compressed: ${olderMessages.length} messages removed to save context. Key topics discussed included: ${this.extractTopics(olderMessages)}]`;

            const newMessages: Message[] = [];
            if (systemMessage) {
                newMessages.push(systemMessage);
            }
            newMessages.push({
                role: 'assistant',
                content: summaryContent,
            });
            newMessages.push(...recentMessages);

            this.session.messages = newMessages;
        }
    }

    private extractTopics(messages: Message[]): string {
        // Simple topic extraction - just get first few words from user messages
        const userMessages = messages
            .filter((m) => m.role === 'user')
            .map((m) => {
                const content = typeof m.content === 'string' ? m.content : '';
                return content.substring(0, 50).replace(/\n/g, ' ');
            })
            .slice(0, 5);

        return userMessages.join(', ') || 'general coding assistance';
    }

    async save(name?: string): Promise<string> {
        await fs.mkdir(this.configDir, { recursive: true });

        // Save to local project config
        const historyPath = path.join(this.configDir, HISTORY_FILE);
        const data = JSON.stringify(this.session, null, 2);
        await fs.writeFile(historyPath, data, 'utf-8');

        // Also save to global session storage for --continue/--resume
        const { sessionStorage } = await import('./storage.js');
        const preview = this.getPreview();
        await sessionStorage.saveSession(
            this.session.id,
            name || null,
            this.session,
            {
                projectPath: this.session.metadata.projectPath,
                model: this.session.metadata.model,
                messageCount: this.session.messages.length,
                preview,
            }
        );

        return historyPath;
    }

    /**
     * Get a preview of the session (first user message)
     */
    private getPreview(): string {
        const userMessage = this.session.messages.find(m => m.role === 'user');
        if (userMessage && typeof userMessage.content === 'string') {
            return userMessage.content.substring(0, 100).replace(/\n/g, ' ');
        }
        return '';
    }

    /**
     * Load from global session storage (for --continue/--resume)
     */
    async loadFromGlobalStorage(sessionIdOrName?: string): Promise<boolean> {
        const { sessionStorage } = await import('./storage.js');

        let sessionData: unknown;
        if (sessionIdOrName) {
            sessionData = await sessionStorage.loadSession(sessionIdOrName);
        } else {
            const last = await sessionStorage.loadLastSession();
            sessionData = last?.data;
        }

        if (sessionData && typeof sessionData === 'object' && sessionData !== null) {
            const loaded = sessionData as Session;
            this.session = {
                ...loaded,
                startTime: new Date(loaded.startTime),
            };
            return true;
        }
        return false;
    }

    /**
     * Set a name for the current session
     */
    setSessionName(name: string): void {
        // Store the name - will be used when saving
        (this.session as Session & { name?: string }).name = name;
    }


    async load(sessionId?: string): Promise<boolean> {
        const historyPath = path.join(this.configDir, HISTORY_FILE);

        try {
            const data = await fs.readFile(historyPath, 'utf-8');
            const loaded = JSON.parse(data) as Session;

            if (!sessionId || loaded.id === sessionId) {
                this.session = {
                    ...loaded,
                    startTime: new Date(loaded.startTime),
                };
                return true;
            }
        } catch {
            // No history file or invalid format
        }

        return false;
    }

    getSessionId(): string {
        return this.session.id;
    }

    getStartTime(): Date {
        return this.session.startTime;
    }
}
