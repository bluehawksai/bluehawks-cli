/**
 * Bluehawks CLI - Slash Commands
 */

export interface Command {
    name: string;
    aliases?: string[];
    description: string;
    execute: (args: string[], context: CommandContext) => Promise<string> | string;
}

export interface CommandContext {
    sessionManager: {
        getStats: () => {
            messageCount: number;
            userMessages: number;
            assistantMessages: number;
            toolMessages: number;
            tokensUsed: number;
            toolsUsed: string[];
            duration: number;
        };
        clear: () => void;
        compressHistory: () => void;
        save: () => Promise<string>;
    };
    orchestrator: {
        setPlanMode: (enabled: boolean) => void;
        isPlanMode: () => boolean;
        getSubAgents: () => Array<{ name: string; description: string }>;
    };
    toolRegistry: {
        getAll: () => Array<{ name: string; definition: { function: { description: string } } }>;
    };
    onExit: () => void;
}

// Help command
const helpCommand: Command = {
    name: 'help',
    aliases: ['h', '?'],
    description: 'Show available commands',
    execute: (_args, _context) => {
        const lines: string[] = [
            '📘 Available Commands:',
            '',
            '  /help, /h, /?         Show this help message',
            '  /clear, /c            Clear conversation history',
            '  /stats, /s            Show session statistics',
            '  /tools                List available tools',
            '  /agents               List available sub-agents',
            '  /plan                 Toggle plan mode (think before acting)',
            '  /compress             Compress conversation history',
            '  /save                 Save current session',
            '  /yolo                 Toggle YOLO mode (auto-approve all tools)',
            '  /exit, /quit, /q      Exit Bluehawks',
            '',
            '💡 Tips:',
            '  - Use @ to reference files: @src/index.ts',
            '  - Use Ctrl+C to cancel current operation',
            '  - Use Up/Down arrows for command history',
        ];

        return lines.join('\n');
    },
};

// Clear command
const clearCommand: Command = {
    name: 'clear',
    aliases: ['c'],
    description: 'Clear conversation history',
    execute: (_args, context) => {
        context.sessionManager.clear();
        return '🗑️  Conversation history cleared.';
    },
};

// Stats command
const statsCommand: Command = {
    name: 'stats',
    aliases: ['s'],
    description: 'Show session statistics',
    execute: (_args, context) => {
        const stats = context.sessionManager.getStats();
        const duration = Math.floor(stats.duration / 1000);
        const minutes = Math.floor(duration / 60);
        const seconds = duration % 60;

        const lines: string[] = [
            '📊 Session Statistics:',
            '',
            `  Messages:      ${stats.messageCount}`,
            `  User:          ${stats.userMessages}`,
            `  Assistant:     ${stats.assistantMessages}`,
            `  Tool calls:    ${stats.toolMessages}`,
            `  Tokens used:   ${stats.tokensUsed}`,
            `  Duration:      ${minutes}m ${seconds}s`,
            '',
        ];

        if (stats.toolsUsed.length > 0) {
            lines.push(`  Tools used:    ${stats.toolsUsed.join(', ')}`);
        }

        return lines.join('\n');
    },
};

// Tools command
const toolsCommand: Command = {
    name: 'tools',
    description: 'List available tools',
    execute: (_args, context) => {
        const tools = context.toolRegistry.getAll();
        const lines: string[] = ['🔧 Available Tools:', ''];

        for (const tool of tools) {
            const desc = tool.definition.function.description.substring(0, 60);
            lines.push(`  ${tool.name.padEnd(20)} ${desc}...`);
        }

        return lines.join('\n');
    },
};

// Agents command
const agentsCommand: Command = {
    name: 'agents',
    description: 'List available sub-agents',
    execute: (_args, context) => {
        const agents = context.orchestrator.getSubAgents();
        const lines: string[] = ['🤖 Available Sub-Agents:', ''];

        for (const agent of agents) {
            lines.push(`  ${agent.name.padEnd(15)} ${agent.description}`);
        }

        return lines.join('\n');
    },
};

// Plan command
const planCommand: Command = {
    name: 'plan',
    description: 'Toggle plan mode',
    execute: (_args, context) => {
        const current = context.orchestrator.isPlanMode();
        context.orchestrator.setPlanMode(!current);

        if (!current) {
            return '📋 Plan mode enabled. I will create a plan before making changes.';
        } else {
            return '⚡ Plan mode disabled. I will execute tasks directly.';
        }
    },
};

// Compress command
const compressCommand: Command = {
    name: 'compress',
    description: 'Compress conversation history',
    execute: (_args, context) => {
        context.sessionManager.compressHistory();
        return '📦 Conversation history compressed to save tokens.';
    },
};

// Save command
const saveCommand: Command = {
    name: 'save',
    description: 'Save current session',
    execute: async (_args, context) => {
        const path = await context.sessionManager.save();
        return `💾 Session saved to: ${path}`;
    },
};

// Exit command
const exitCommand: Command = {
    name: 'exit',
    aliases: ['quit', 'q'],
    description: 'Exit Bluehawks',
    execute: (_args, context) => {
        context.onExit();
        return '👋 Goodbye!';
    },
};

// Bug command
const bugCommand: Command = {
    name: 'bug',
    description: 'Report a bug',
    execute: () => {
        return `🐛 To report a bug:
1. Go to: https://github.com/bluehawks/cli/issues
2. Click "New Issue"
3. Describe the bug with steps to reproduce

Thank you for helping improve Bluehawks!`;
    },
};

// All commands
export const commands: Command[] = [
    helpCommand,
    clearCommand,
    statsCommand,
    toolsCommand,
    agentsCommand,
    planCommand,
    compressCommand,
    saveCommand,
    exitCommand,
    bugCommand,
];

// Command registry
class CommandRegistry {
    private commands: Map<string, Command> = new Map();

    constructor() {
        for (const cmd of commands) {
            this.register(cmd);
        }
    }

    register(command: Command): void {
        this.commands.set(command.name, command);
        if (command.aliases) {
            for (const alias of command.aliases) {
                this.commands.set(alias, command);
            }
        }
    }

    get(name: string): Command | undefined {
        return this.commands.get(name);
    }

    async execute(input: string, context: CommandContext): Promise<string | null> {
        if (!input.startsWith('/')) return null;

        const parts = input.slice(1).split(/\s+/);
        const commandName = parts[0].toLowerCase();
        const args = parts.slice(1);

        const command = this.get(commandName);
        if (!command) {
            return `Unknown command: /${commandName}. Type /help for available commands.`;
        }

        return command.execute(args, context);
    }

    isCommand(input: string): boolean {
        return input.startsWith('/');
    }
}

export const commandRegistry = new CommandRegistry();
