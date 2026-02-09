import { toolRegistry, type ToolHandler } from '../registry.js';
import { memoryManager } from '../../memory/index.js';

// Remember Tool
const rememberTool: ToolHandler = {
    name: 'remember',
    safeToAutoRun: true,
    definition: {
        type: 'function',
        function: {
            name: 'remember',
            description:
                'Store a piece of information, preference, or concept in long-term memory. Use this to remember user choices, project guidelines, or important facts.',
            parameters: {
                type: 'object',
                properties: {
                    content: {
                        type: 'string',
                        description: 'The information to remember.',
                    },
                    type: {
                        type: 'string',
                        enum: ['preference', 'mistake', 'knowledge', 'task_context'],
                        description: 'The type of memory. Default is knowledge.',
                    },
                    tags: {
                        type: 'array',
                        items: { type: 'string' },
                        description: 'Tags to categorize this memory.',
                    },
                },
                required: ['content'],
            },
        },
    },
    async execute(args) {
        const content = args.content as string;
        const type = (args.type as any) || 'knowledge';
        const tags = (args.tags as string[]) || [];

        const memory = await memoryManager.remember(content, type, { tags });
        return `Remembered: "${content}" (ID: ${memory.id})`;
    },
};

// Recall Tool
const recallTool: ToolHandler = {
    name: 'recall',
    safeToAutoRun: true,
    definition: {
        type: 'function',
        function: {
            name: 'recall',
            description:
                'Search long-term memory for relevant information. Use this to find past decisions, user preferences, or project guidelines.',
            parameters: {
                type: 'object',
                properties: {
                    query: {
                        type: 'string',
                        description: 'The search query to find relevant memories.',
                    },
                    limit: {
                        type: 'number',
                        description: 'Maximum number of results to return. Default is 5.',
                    },
                },
                required: ['query'],
            },
        },
    },
    async execute(args) {
        const query = args.query as string;
        const limit = (args.limit as number) || 5;

        const results = await memoryManager.search(query, limit);
        if (results.length === 0) {
            return 'No relevant memories found.';
        }

        return results
            .map(
                (m) =>
                    `[${m.type.toUpperCase()}] ${m.content} (Similarity: ${(m.similarity * 100).toFixed(1)}%)`
            )
            .join('\n');
    },
};

// Forget Tool
const forgetTool: ToolHandler = {
    name: 'forget',
    safeToAutoRun: false, // Deletion is unsafe
    definition: {
        type: 'function',
        function: {
            name: 'forget',
            description: 'Delete a memory by its ID.',
            parameters: {
                type: 'object',
                properties: {
                    id: {
                        type: 'string',
                        description: 'The ID of the memory to delete.',
                    },
                },
                required: ['id'],
            },
        },
    },
    async execute(args) {
        const id = args.id as string;
        await memoryManager.forget(id);
        return `Forgot memory with ID: ${id}`;
    },
};

// Learn Mistake Tool
const learnMistakeTool: ToolHandler = {
    name: 'learn_mistake',
    safeToAutoRun: true, // Learning is safe
    definition: {
        type: 'function',
        function: {
            name: 'learn_mistake',
            description:
                'Record a mistake and its solution to avoid repeating it in the future.',
            parameters: {
                type: 'object',
                properties: {
                    error: {
                        type: 'string',
                        description: 'The error or mistake that occurred.',
                    },
                    fix: {
                        type: 'string',
                        description: 'The solution or lesson learned.',
                    },
                    context: {
                        type: 'string',
                        description: 'Optional context (e.g., file path, command).',
                    },
                },
                required: ['error', 'fix'],
            },
        },
    },
    async execute(args) {
        const error = args.error as string;
        const fix = args.fix as string;
        const context = args.context as string | undefined;

        const content = `Mistake: ${error}\nSolution: ${fix}${context ? `\nContext: ${context}` : ''}`;

        const memory = await memoryManager.remember(content, 'mistake', {
            originalError: error,
            fix,
            context,
        });

        return `Recorded mistake and solution (ID: ${memory.id}). I will remember this to avoid it in the future.`;
    },
};

// Register all memory tools
export function registerMemoryTools(): void {
    toolRegistry.register(rememberTool);
    toolRegistry.register(recallTool);
    toolRegistry.register(forgetTool);
    toolRegistry.register(learnMistakeTool);
}
