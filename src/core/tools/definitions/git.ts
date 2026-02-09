/**
 * Bluehawks CLI - Git Tools
 * Tools for Git operations
 */

import { simpleGit, type SimpleGit, type StatusResult } from 'simple-git';
import { toolRegistry, type ToolHandler } from '../registry.js';

function getGit(cwd?: string): SimpleGit {
    return simpleGit(cwd || process.cwd());
}

const gitStatusTool: ToolHandler = {
    name: 'git_status',
    safeToAutoRun: true,
    definition: {
        type: 'function',
        function: {
            name: 'git_status',
            description: 'Get the current Git status of the repository.',
            parameters: {
                type: 'object',
                properties: {
                    cwd: {
                        type: 'string',
                        description: 'The working directory. Defaults to current directory.',
                    },
                },
                required: [],
            },
        },
    },
    async execute(args) {
        const cwd = args.cwd as string | undefined;
        const git = getGit(cwd);

        const status: StatusResult = await git.status();

        const lines: string[] = [];
        lines.push(`Branch: ${status.current || 'unknown'}`);
        lines.push(`Tracking: ${status.tracking || 'none'}`);

        if (status.ahead > 0) lines.push(`Ahead: ${status.ahead} commits`);
        if (status.behind > 0) lines.push(`Behind: ${status.behind} commits`);

        if (status.staged.length > 0) {
            lines.push('\nStaged changes:');
            status.staged.forEach((f) => lines.push(`  ✓ ${f}`));
        }

        if (status.modified.length > 0) {
            lines.push('\nModified:');
            status.modified.forEach((f) => lines.push(`  M ${f}`));
        }

        if (status.not_added.length > 0) {
            lines.push('\nUntracked:');
            status.not_added.forEach((f) => lines.push(`  ? ${f}`));
        }

        if (status.deleted.length > 0) {
            lines.push('\nDeleted:');
            status.deleted.forEach((f) => lines.push(`  D ${f}`));
        }

        if (
            status.staged.length === 0 &&
            status.modified.length === 0 &&
            status.not_added.length === 0 &&
            status.deleted.length === 0
        ) {
            lines.push('\nWorking tree clean');
        }

        return lines.join('\n');
    },
};

const gitDiffTool: ToolHandler = {
    name: 'git_diff',
    safeToAutoRun: true,
    definition: {
        type: 'function',
        function: {
            name: 'git_diff',
            description: 'Show git diff for the repository or specific files.',
            parameters: {
                type: 'object',
                properties: {
                    files: {
                        type: 'array',
                        items: { type: 'string' },
                        description: 'Optional list of files to show diff for.',
                    },
                    staged: {
                        type: 'boolean',
                        description: 'Show diff for staged changes. Default is false.',
                    },
                    cwd: {
                        type: 'string',
                        description: 'The working directory.',
                    },
                },
                required: [],
            },
        },
    },
    async execute(args) {
        const files = args.files as string[] | undefined;
        const staged = (args.staged as boolean) ?? false;
        const cwd = args.cwd as string | undefined;

        const git = getGit(cwd);

        const options = staged ? ['--staged'] : [];
        if (files && files.length > 0) {
            options.push('--', ...files);
        }

        const diff = await git.diff(options);

        if (!diff.trim()) {
            return staged ? 'No staged changes' : 'No changes';
        }

        return diff;
    },
};

const gitLogTool: ToolHandler = {
    name: 'git_log',
    safeToAutoRun: true,
    definition: {
        type: 'function',
        function: {
            name: 'git_log',
            description: 'Show git commit history.',
            parameters: {
                type: 'object',
                properties: {
                    count: {
                        type: 'number',
                        description: 'Number of commits to show. Default is 10.',
                    },
                    file: {
                        type: 'string',
                        description: 'Show history for a specific file.',
                    },
                    cwd: {
                        type: 'string',
                        description: 'The working directory.',
                    },
                },
                required: [],
            },
        },
    },
    async execute(args) {
        const count = (args.count as number) || 10;
        const file = args.file as string | undefined;
        const cwd = args.cwd as string | undefined;

        const git = getGit(cwd);

        const options: string[] = [`-n`, `${count}`, '--oneline'];
        if (file) {
            options.push('--', file);
        }

        const log = await git.log(options);

        if (!log.all || log.all.length === 0) {
            return 'No commits found';
        }

        return log.all
            .map((commit) => `${commit.hash.substring(0, 7)} ${commit.message}`)
            .join('\n');
    },
};

const gitCommitTool: ToolHandler = {
    name: 'git_commit',
    safeToAutoRun: false,
    definition: {
        type: 'function',
        function: {
            name: 'git_commit',
            description: 'Create a Git commit with the staged changes.',
            parameters: {
                type: 'object',
                properties: {
                    message: {
                        type: 'string',
                        description: 'The commit message.',
                    },
                    cwd: {
                        type: 'string',
                        description: 'The working directory.',
                    },
                },
                required: ['message'],
            },
        },
    },
    async execute(args) {
        const message = args.message as string;
        const cwd = args.cwd as string | undefined;

        const git = getGit(cwd);

        const result = await git.commit(message);

        return `Committed: ${result.commit || 'unknown'}\nSummary: ${result.summary.changes} files changed, ${result.summary.insertions} insertions, ${result.summary.deletions} deletions`;
    },
};

const gitAddTool: ToolHandler = {
    name: 'git_add',
    safeToAutoRun: false,
    definition: {
        type: 'function',
        function: {
            name: 'git_add',
            description: 'Stage files for commit.',
            parameters: {
                type: 'object',
                properties: {
                    files: {
                        type: 'array',
                        items: { type: 'string' },
                        description: 'Files to stage. Use ["."] to stage all changes.',
                    },
                    cwd: {
                        type: 'string',
                        description: 'The working directory.',
                    },
                },
                required: ['files'],
            },
        },
    },
    async execute(args) {
        const files = args.files as string[];
        const cwd = args.cwd as string | undefined;

        const git = getGit(cwd);

        await git.add(files);

        return `Staged: ${files.join(', ')}`;
    },
};

const gitBranchTool: ToolHandler = {
    name: 'git_branch',
    safeToAutoRun: true,
    definition: {
        type: 'function',
        function: {
            name: 'git_branch',
            description: 'List, create, or switch Git branches.',
            parameters: {
                type: 'object',
                properties: {
                    action: {
                        type: 'string',
                        enum: ['list', 'create', 'switch', 'delete'],
                        description: 'The action to perform. Default is "list".',
                    },
                    name: {
                        type: 'string',
                        description: 'Branch name (required for create, switch, delete).',
                    },
                    cwd: {
                        type: 'string',
                        description: 'The working directory.',
                    },
                },
                required: [],
            },
        },
    },
    async execute(args) {
        const action = (args.action as string) || 'list';
        const name = args.name as string | undefined;
        const cwd = args.cwd as string | undefined;

        const git = getGit(cwd);

        switch (action) {
            case 'list': {
                const branches = await git.branch();
                return branches.all
                    .map((b) => (b === branches.current ? `* ${b}` : `  ${b}`))
                    .join('\n');
            }
            case 'create': {
                if (!name) throw new Error('Branch name is required');
                await git.checkoutLocalBranch(name);
                return `Created and switched to branch: ${name}`;
            }
            case 'switch': {
                if (!name) throw new Error('Branch name is required');
                await git.checkout(name);
                return `Switched to branch: ${name}`;
            }
            case 'delete': {
                if (!name) throw new Error('Branch name is required');
                await git.deleteLocalBranch(name);
                return `Deleted branch: ${name}`;
            }
            default:
                throw new Error(`Unknown action: ${action}`);
        }
    },
};

export function registerGitTools(): void {
    toolRegistry.register(gitStatusTool);
    toolRegistry.register(gitDiffTool);
    toolRegistry.register(gitLogTool);
    toolRegistry.register(gitCommitTool);
    toolRegistry.register(gitAddTool);
    toolRegistry.register(gitBranchTool);
}
