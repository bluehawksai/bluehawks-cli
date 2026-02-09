/**
 * Bluehawks CLI - Agent Orchestrator
 * Coordinates multiple agents for complex tasks
 */

import { APIClient } from '../api/client.js';
import { ToolExecutor } from '../tools/executor.js';
import { Agent, type AgentResponse } from './agent.js';
import { CONTEXT_FILE } from '../../config/constants.js';
import { getSystemPrompt } from './prompts.js';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { memoryManager } from '../memory/index.js'; // Corrected path

export interface SubAgentConfig {
    name: string;
    description: string;
    systemPrompt: string;
    tools?: string[];
}

export interface OrchestratorOptions {
    projectPath: string;
    apiClient: APIClient;
    toolExecutor: ToolExecutor;
    planMode?: boolean;
    maxTurns?: number;
    systemPrompt?: string;
    appendSystemPrompt?: string;
}



export class Orchestrator {
    private apiClient: APIClient;
    private toolExecutor: ToolExecutor;
    private projectPath: string;
    private planMode: boolean;
    private maxTurns: number;
    private customSystemPrompt?: string;
    private appendSystemPrompt?: string;
    private contextContent: string = '';
    private rootStructure: string = '';
    private subAgents: Map<string, SubAgentConfig> = new Map();
    private conversationHistory: Array<{ role: string; content: string }> = [];


    constructor(options: OrchestratorOptions) {
        this.apiClient = options.apiClient;
        this.toolExecutor = options.toolExecutor;
        this.projectPath = options.projectPath;
        this.planMode = options.planMode || false;
        this.maxTurns = options.maxTurns || 15;
        this.customSystemPrompt = options.systemPrompt;
        this.appendSystemPrompt = options.appendSystemPrompt;

        // Register default sub-agents
        this.registerDefaultSubAgents();
    }


    private registerDefaultSubAgents(): void {
        this.subAgents.set('coder', {
            name: 'coder',
            description: 'Specialized in writing and modifying code',
            systemPrompt: `You are a code-focused agent. Your job is to write clean, efficient code and make targeted modifications to existing code. Focus on:
- Writing idiomatic code for the project's language
- Following existing code conventions
- Making minimal, focused changes
- Adding appropriate comments when needed`,
            tools: ['read_file', 'write_file', 'edit_file', 'grep_search', 'find_files'],
        });

        this.subAgents.set('researcher', {
            name: 'researcher',
            description: 'Specialized in gathering information and research',
            systemPrompt: `You are a research agent. Your job is to gather information about the codebase and external resources. Focus on:
- Reading and understanding code structure
- Finding relevant files and functions
- Fetching documentation when needed
- Summarizing findings clearly`,
            tools: ['read_file', 'list_directory', 'grep_search', 'find_files', 'fetch_url'],
        });

        this.subAgents.set('shell', {
            name: 'shell',
            description: 'Specialized in running commands and automation',
            systemPrompt: `You are a shell execution agent. Your job is to run commands safely and interpret their output. Focus on:
- Running build, test, and utility commands
- Interpreting command output
- Suggesting fixes for errors
- Managing git operations`,
            tools: ['run_command', 'git_status', 'git_diff', 'git_add', 'git_commit'],
        });
    }

    async initialize(): Promise<void> {
        // Load context file if it exists
        await this.loadContextFile();
        // Load root directory structure
        await this.loadRootStructure();
    }

    private async loadContextFile(): Promise<void> {
        const contextPath = path.join(this.projectPath, CONTEXT_FILE);
        try {
            this.contextContent = await fs.readFile(contextPath, 'utf-8');
        } catch {
            this.contextContent = '';
        }
    }

    private async loadRootStructure(): Promise<void> {
        try {
            const entries = await fs.readdir(this.projectPath, { withFileTypes: true });
            const list = entries
                .filter(e => !e.name.startsWith('.') && e.name !== 'node_modules' && e.name !== 'dist')
                .map(e => `${e.isDirectory() ? '📂' : '📄'} ${e.name}`)
                .join('\n');
            this.rootStructure = list;
        } catch {
            this.rootStructure = '';
        }
    }

    private buildSystemPrompt(): string {
        // Use custom system prompt if provided, otherwise default
        let prompt = this.customSystemPrompt || getSystemPrompt();

        // Append additional prompt content if provided
        if (this.appendSystemPrompt) {
            prompt += `\n\n${this.appendSystemPrompt}`;
        }

        if (this.rootStructure) {
            prompt += `\n\n## Current Directory Structure\n${this.rootStructure}\n\nUse this context to understand the project structure and answer questions about the codebase. If the user asks about specific files, use read_file to examine them.`;
        }

        if (this.contextContent) {
            prompt += `\n\n## Project Context (from ${CONTEXT_FILE})\n\n${this.contextContent}`;
        }

        if (this.planMode) {
            prompt += `\n\n## Plan Mode Active
Before making any changes, first:
1. Analyze the request
2. Create a step-by-step plan
3. Present the plan to the user
4. Wait for approval before proceeding
5. Execute each step, reporting progress`;
        }

        return prompt;
    }

    async chat(
        userMessage: string,
        _history: Array<{ role: string; content: string }> = [],
        callbacks?: {
            onChunk?: (content: string) => void;
            onToolStart?: (name: string) => void;
            onToolEnd?: (name: string, result: string) => void;
        }
    ): Promise<AgentResponse> {
        // Add user message to conversation history
        this.conversationHistory.push({ role: 'user', content: userMessage });

        // Retrieve relevant memories
        const memories = await memoryManager.search(userMessage, 5);
        let systemPrompt = this.buildSystemPrompt();

        if (memories.length > 0) {
            const memoryContext = memories
                .map(m => `- [${m.type.toUpperCase()}] ${m.content}`)
                .join('\n');
            systemPrompt += `\n\n## Long-Term Memory (Relevant Context)\n${memoryContext}\n\nUse this information to guide your decisions and avoid past mistakes.`;
        }

        const mainAgent = new Agent(
            {
                name: 'main',
                systemPrompt,
                maxIterations: this.maxTurns,
            },
            this.apiClient,
            this.toolExecutor
        );

        // Pass conversation history (excluding current message which will be added by agent)
        const priorHistory = this.conversationHistory.slice(0, -1);
        const response = await mainAgent.run(
            userMessage,
            callbacks?.onChunk,
            callbacks?.onToolStart,
            callbacks?.onToolEnd,
            priorHistory
        );

        // Add assistant response to history
        if (response.content) {
            this.conversationHistory.push({ role: 'assistant', content: response.content });
        }

        return response;
    }

    async runSubAgent(
        agentName: string,
        task: string,
        callbacks?: {
            onChunk?: (content: string) => void;
            onToolStart?: (name: string) => void;
            onToolEnd?: (name: string, result: string) => void;
        }
    ): Promise<AgentResponse> {
        const config = this.subAgents.get(agentName);
        if (!config) {
            throw new Error(`Unknown sub-agent: ${agentName}`);
        }

        const agent = new Agent(
            {
                name: config.name,
                systemPrompt: config.systemPrompt,
                tools: config.tools,
                maxIterations: 10,
            },
            this.apiClient,
            this.toolExecutor
        );

        return agent.run(task, callbacks?.onChunk, callbacks?.onToolStart, callbacks?.onToolEnd);
    }

    setPlanMode(enabled: boolean): void {
        this.planMode = enabled;
    }

    isPlanMode(): boolean {
        return this.planMode;
    }

    getSubAgents(): SubAgentConfig[] {
        return Array.from(this.subAgents.values());
    }

    registerSubAgent(config: SubAgentConfig): void {
        this.subAgents.set(config.name, config);
    }
}
