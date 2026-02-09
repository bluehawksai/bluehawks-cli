/**
 * Bluehawks CLI - Search Tools
 * Tools for searching files and code
 */

import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { toolRegistry, type ToolHandler } from '../registry.js';

interface SearchMatch {
    file: string;
    line: number;
    content: string;
}

async function searchInFile(
    filePath: string,
    pattern: RegExp,
    maxMatches: number
): Promise<SearchMatch[]> {
    const matches: SearchMatch[] = [];

    try {
        const content = await fs.readFile(filePath, 'utf-8');
        const lines = content.split('\n');

        for (let i = 0; i < lines.length && matches.length < maxMatches; i++) {
            if (pattern.test(lines[i])) {
                matches.push({
                    file: filePath,
                    line: i + 1,
                    content: lines[i].trim().substring(0, 200),
                });
            }
        }
    } catch {
        // Skip files that can't be read
    }

    return matches;
}

async function walkDirectory(
    dir: string,
    includes: string[],
    excludes: string[],
    maxDepth: number,
    currentDepth = 0
): Promise<string[]> {
    if (currentDepth > maxDepth) return [];

    const files: string[] = [];

    try {
        const entries = await fs.readdir(dir, { withFileTypes: true });

        for (const entry of entries) {
            const fullPath = path.join(dir, entry.name);

            // Skip excluded patterns
            if (excludes.some((ex) => entry.name === ex || entry.name.includes(ex))) {
                continue;
            }

            if (entry.isDirectory()) {
                const subFiles = await walkDirectory(fullPath, includes, excludes, maxDepth, currentDepth + 1);
                files.push(...subFiles);
            } else if (entry.isFile()) {
                // Check includes
                if (includes.length === 0 || includes.some((inc) => entry.name.endsWith(inc))) {
                    files.push(fullPath);
                }
            }
        }
    } catch {
        // Skip directories we can't read
    }

    return files;
}

const grepSearchTool: ToolHandler = {
    name: 'grep_search',
    safeToAutoRun: true,
    definition: {
        type: 'function',
        function: {
            name: 'grep_search',
            description:
                'Search for a pattern in files. Returns matching lines with file paths and line numbers.',
            parameters: {
                type: 'object',
                properties: {
                    pattern: {
                        type: 'string',
                        description: 'The search pattern (regex supported).',
                    },
                    path: {
                        type: 'string',
                        description: 'The directory to search in. Defaults to current directory.',
                    },
                    includes: {
                        type: 'array',
                        items: { type: 'string' },
                        description: 'File extensions to include (e.g., [".ts", ".js"]).',
                    },
                    excludes: {
                        type: 'array',
                        items: { type: 'string' },
                        description: 'Patterns to exclude (e.g., ["node_modules", ".git"]).',
                    },
                    case_insensitive: {
                        type: 'boolean',
                        description: 'Whether to perform case-insensitive search. Default is false.',
                    },
                    max_results: {
                        type: 'number',
                        description: 'Maximum number of results to return. Default is 50.',
                    },
                },
                required: ['pattern'],
            },
        },
    },
    async execute(args) {
        const patternStr = args.pattern as string;
        const searchPath = (args.path as string) || process.cwd();
        const includes = (args.includes as string[]) || [];
        const excludes = (args.excludes as string[]) || ['node_modules', '.git', 'dist', 'build'];
        const caseInsensitive = (args.case_insensitive as boolean) ?? false;
        const maxResults = (args.max_results as number) || 50;

        const absolutePath = path.resolve(process.cwd(), searchPath);
        const flags = caseInsensitive ? 'gi' : 'g';
        const pattern = new RegExp(patternStr, flags);

        const files = await walkDirectory(absolutePath, includes, excludes, 10);
        const allMatches: SearchMatch[] = [];

        for (const file of files) {
            if (allMatches.length >= maxResults) break;

            const matches = await searchInFile(file, pattern, maxResults - allMatches.length);
            for (const match of matches) {
                allMatches.push({
                    ...match,
                    file: path.relative(process.cwd(), match.file),
                });
            }
        }

        if (allMatches.length === 0) {
            return `No matches found for pattern: ${patternStr}`;
        }

        const output = allMatches
            .map((m) => `${m.file}:${m.line}: ${m.content}`)
            .join('\n');

        return `Found ${allMatches.length} matches:\n\n${output}`;
    },
};

const findFilesTool: ToolHandler = {
    name: 'find_files',
    safeToAutoRun: true,
    definition: {
        type: 'function',
        function: {
            name: 'find_files',
            description: 'Find files by name or pattern in a directory.',
            parameters: {
                type: 'object',
                properties: {
                    pattern: {
                        type: 'string',
                        description: 'The filename pattern to search for (supports wildcards like *.ts).',
                    },
                    path: {
                        type: 'string',
                        description: 'The directory to search in. Defaults to current directory.',
                    },
                    type: {
                        type: 'string',
                        enum: ['file', 'directory', 'any'],
                        description: 'Type of entries to find. Default is "any".',
                    },
                    max_depth: {
                        type: 'number',
                        description: 'Maximum directory depth to search. Default is 10.',
                    },
                    max_results: {
                        type: 'number',
                        description: 'Maximum number of results. Default is 100.',
                    },
                },
                required: ['pattern'],
            },
        },
    },
    async execute(args) {
        const pattern = args.pattern as string;
        const searchPath = (args.path as string) || process.cwd();
        const type = (args.type as string) || 'any';
        const maxDepth = (args.max_depth as number) || 10;
        const maxResults = (args.max_results as number) || 100;

        const absolutePath = path.resolve(process.cwd(), searchPath);
        const results: string[] = [];

        // Convert glob pattern to regex
        const regexPattern = pattern
            .replace(/\./g, '\\.')
            .replace(/\*/g, '.*')
            .replace(/\?/g, '.');
        const regex = new RegExp(`^${regexPattern}$`, 'i');

        async function search(dir: string, depth: number): Promise<void> {
            if (depth > maxDepth || results.length >= maxResults) return;

            try {
                const entries = await fs.readdir(dir, { withFileTypes: true });

                for (const entry of entries) {
                    if (results.length >= maxResults) return;

                    // Skip common excludes
                    if (entry.name === 'node_modules' || entry.name === '.git') continue;

                    const fullPath = path.join(dir, entry.name);
                    const relativePath = path.relative(absolutePath, fullPath);

                    const isMatch = regex.test(entry.name);
                    const matchesType =
                        type === 'any' ||
                        (type === 'file' && entry.isFile()) ||
                        (type === 'directory' && entry.isDirectory());

                    if (isMatch && matchesType) {
                        const prefix = entry.isDirectory() ? '📁 ' : '📄 ';
                        results.push(prefix + relativePath);
                    }

                    if (entry.isDirectory()) {
                        await search(fullPath, depth + 1);
                    }
                }
            } catch {
                // Skip directories we can't read
            }
        }

        await search(absolutePath, 0);

        if (results.length === 0) {
            return `No files found matching pattern: ${pattern}`;
        }

        return `Found ${results.length} matches:\n\n${results.join('\n')}`;
    },
};

export function registerSearchTools(): void {
    toolRegistry.register(grepSearchTool);
    toolRegistry.register(findFilesTool);
}
