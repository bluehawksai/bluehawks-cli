/**
 * Bluehawks CLI - File System Tools
 * Tools for reading, writing, and editing files
 */

import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { toolRegistry, type ToolHandler } from '../registry.js';
import { MAX_FILE_SIZE_BYTES } from '../../../config/constants.js';

// Read File Tool
const readFileTool: ToolHandler = {
    name: 'read_file',
    safeToAutoRun: true,
    definition: {
        type: 'function',
        function: {
            name: 'read_file',
            description:
                'Read the contents of a file. Use this to understand code, configuration, or any text file.',
            parameters: {
                type: 'object',
                properties: {
                    path: {
                        type: 'string',
                        description: 'The absolute or relative path to the file to read.',
                    },
                    start_line: {
                        type: 'number',
                        description: 'Optional. The starting line number (1-indexed) to read from.',
                    },
                    end_line: {
                        type: 'number',
                        description: 'Optional. The ending line number (1-indexed) to read to.',
                    },
                },
                required: ['path'],
            },
        },
    },
    async execute(args) {
        const filePath = (args.path || args.file) as string;
        const startLine = args.start_line as number | undefined;
        const endLine = args.end_line as number | undefined;

        if (!filePath) {
            throw new Error('Missing required argument: path');
        }

        const absolutePath = path.resolve(process.cwd(), filePath);

        // Check if file exists
        try {
            await fs.access(absolutePath);
        } catch {
            throw new Error(`File not found: ${filePath}`);
        }

        // Check file size
        const stats = await fs.stat(absolutePath);
        if (stats.size > MAX_FILE_SIZE_BYTES) {
            throw new Error(`File too large: ${stats.size} bytes (max: ${MAX_FILE_SIZE_BYTES})`);
        }

        let content = await fs.readFile(absolutePath, 'utf-8');

        // Handle line range if specified
        if (startLine !== undefined || endLine !== undefined) {
            const lines = content.split('\n');
            const start = Math.max(1, startLine || 1) - 1;
            const end = Math.min(lines.length, endLine || lines.length);
            content = lines.slice(start, end).join('\n');
        }

        return content;
    },
};

// Write File Tool
const writeFileTool: ToolHandler = {
    name: 'write_file',
    safeToAutoRun: false,
    definition: {
        type: 'function',
        function: {
            name: 'write_file',
            description:
                'Write content to a file. Creates the file if it does not exist, or overwrites if it does.',
            parameters: {
                type: 'object',
                properties: {
                    path: {
                        type: 'string',
                        description: 'The absolute or relative path to the file to write.',
                    },
                    content: {
                        type: 'string',
                        description: 'The content to write to the file.',
                    },
                },
                required: ['path', 'content'],
            },
        },
    },
    async execute(args) {
        const filePath = (args.path || args.file) as string;
        const content = args.content as string;

        if (!filePath) {
            throw new Error('Missing required argument: path');
        }

        const absolutePath = path.resolve(process.cwd(), filePath);

        // Create directory if it doesn't exist
        const dir = path.dirname(absolutePath);
        await fs.mkdir(dir, { recursive: true });

        await fs.writeFile(absolutePath, content, 'utf-8');

        return `Successfully wrote ${content.length} characters to ${filePath}`;
    },
};

// Edit File Tool
const editFileTool: ToolHandler = {
    name: 'edit_file',
    safeToAutoRun: false,
    definition: {
        type: 'function',
        function: {
            name: 'edit_file',
            description:
                'Edit a file by replacing specific content. Use this to make targeted changes to existing files.',
            parameters: {
                type: 'object',
                properties: {
                    path: {
                        type: 'string',
                        description: 'The absolute or relative path to the file to edit.',
                    },
                    old_content: {
                        type: 'string',
                        description: 'The exact content to find and replace.',
                    },
                    new_content: {
                        type: 'string',
                        description: 'The new content to replace with.',
                    },
                },
                required: ['path', 'old_content', 'new_content'],
            },
        },
    },
    async execute(args) {
        const filePath = (args.path || args.file) as string;
        const oldContent = args.old_content as string;
        const newContent = args.new_content as string;

        if (!filePath) {
            throw new Error('Missing required argument: path');
        }

        const absolutePath = path.resolve(process.cwd(), filePath);

        // Read current content
        const content = await fs.readFile(absolutePath, 'utf-8');

        // Check if old content exists
        if (!content.includes(oldContent)) {
            throw new Error(`Could not find the specified content to replace in ${filePath}`);
        }

        // Replace content
        const newFileContent = content.replace(oldContent, newContent);

        // Write back
        await fs.writeFile(absolutePath, newFileContent, 'utf-8');

        return `Successfully edited ${filePath}`;
    },
};

// List Directory Tool
const listDirTool: ToolHandler = {
    name: 'list_directory',
    safeToAutoRun: true,
    definition: {
        type: 'function',
        function: {
            name: 'list_directory',
            description: 'List the contents of a directory, including files and subdirectories.',
            parameters: {
                type: 'object',
                properties: {
                    path: {
                        type: 'string',
                        description: 'The absolute or relative path to the directory to list.',
                    },
                    recursive: {
                        type: 'boolean',
                        description: 'Whether to list recursively. Default is false.',
                    },
                    max_depth: {
                        type: 'number',
                        description: 'Maximum depth to recurse. Default is 3.',
                    },
                },
                required: ['path'],
            },
        },
    },
    async execute(args) {
        const dirPath = (args.path || args.file) as string;
        const recursive = (args.recursive as boolean) ?? false;
        const maxDepth = (args.max_depth as number) ?? 3;

        if (!dirPath) {
            throw new Error('Missing required argument: path');
        }

        const absolutePath = path.resolve(process.cwd(), dirPath);

        async function listDir(dir: string, depth: number): Promise<string[]> {
            if (depth > maxDepth) return [];

            const entries = await fs.readdir(dir, { withFileTypes: true });
            const results: string[] = [];

            for (const entry of entries) {
                // Skip hidden files and common excludes
                if (entry.name.startsWith('.') || entry.name === 'node_modules') continue;

                const relativePath = path.relative(absolutePath, path.join(dir, entry.name));
                const prefix = entry.isDirectory() ? '📁 ' : '📄 ';
                results.push(prefix + relativePath);

                if (recursive && entry.isDirectory()) {
                    const subEntries = await listDir(path.join(dir, entry.name), depth + 1);
                    results.push(...subEntries);
                }
            }

            return results;
        }

        const entries = await listDir(absolutePath, 0);
        return entries.length > 0 ? entries.join('\n') : 'Directory is empty';
    },
};

// Create Directory Tool
const createDirTool: ToolHandler = {
    name: 'create_directory',
    safeToAutoRun: false,
    definition: {
        type: 'function',
        function: {
            name: 'create_directory',
            description: 'Create a new directory, including any necessary parent directories.',
            parameters: {
                type: 'object',
                properties: {
                    path: {
                        type: 'string',
                        description: 'The absolute or relative path of the directory to create.',
                    },
                },
                required: ['path'],
            },
        },
    },
    async execute(args) {
        const dirPath = (args.path || args.file) as string;

        if (!dirPath) {
            throw new Error('Missing required argument: path');
        }

        const absolutePath = path.resolve(process.cwd(), dirPath);

        await fs.mkdir(absolutePath, { recursive: true });

        return `Successfully created directory: ${dirPath}`;
    },
};

// Delete File Tool
const deleteFileTool: ToolHandler = {
    name: 'delete_file',
    safeToAutoRun: false,
    definition: {
        type: 'function',
        function: {
            name: 'delete_file',
            description: 'Delete a file or directory.',
            parameters: {
                type: 'object',
                properties: {
                    path: {
                        type: 'string',
                        description: 'The absolute or relative path to delete.',
                    },
                    recursive: {
                        type: 'boolean',
                        description: 'If true, recursively delete directories. Default is false.',
                    },
                },
                required: ['path'],
            },
        },
    },
    async execute(args) {
        const filePath = (args.path || args.file) as string;
        const recursive = (args.recursive as boolean) ?? false;

        if (!filePath) {
            throw new Error('Missing required argument: path');
        }

        const absolutePath = path.resolve(process.cwd(), filePath);

        await fs.rm(absolutePath, { recursive, force: false });

        return `Successfully deleted: ${filePath}`;
    },
};

// Register all file tools
export function registerFileTools(): void {
    toolRegistry.register(readFileTool);
    toolRegistry.register(writeFileTool);
    toolRegistry.register(editFileTool);
    toolRegistry.register(listDirTool);
    toolRegistry.register(createDirTool);
    toolRegistry.register(deleteFileTool);
}
