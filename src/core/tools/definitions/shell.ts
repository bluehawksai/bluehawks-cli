/**
 * Bluehawks CLI - Shell Command Tool
 * Execute shell commands with safety controls
 */

import { spawn } from 'node:child_process';
import { toolRegistry, type ToolHandler } from '../registry.js';
import { COMMAND_TIMEOUT_MS, MAX_OUTPUT_LENGTH } from '../../../config/constants.js';

// Dangerous command patterns
const DANGEROUS_PATTERNS = [
    /\brm\s+-rf?\s+[\/~]/i,
    /\bsudo\b/i,
    /\bchmod\s+777\b/i,
    /\bchown\b/i,
    /\bmkfs\b/i,
    /\bdd\s+if=/i,
    />\s*\/dev\//i,
    /\bshutdown\b/i,
    /\breboot\b/i,
    /\bhalt\b/i,
    /\bpoweroff\b/i,
];

function isDangerousCommand(command: string): { dangerous: boolean; reason?: string } {
    for (const pattern of DANGEROUS_PATTERNS) {
        if (pattern.test(command)) {
            return {
                dangerous: true,
                reason: `Command matches dangerous pattern: ${pattern.source}`,
            };
        }
    }
    return { dangerous: false };
}

interface CommandResult {
    stdout: string;
    stderr: string;
    exitCode: number | null;
    signal: string | null;
}

async function executeCommand(
    command: string,
    cwd: string,
    timeout: number
): Promise<CommandResult> {
    return new Promise((resolve, reject) => {
        // Determine shell based on platform
        const shell = process.platform === 'win32' ? 'cmd.exe' : '/bin/bash';
        const shellArgs = process.platform === 'win32' ? ['/c', command] : ['-c', command];

        const child = spawn(shell, shellArgs, {
            cwd,
            env: { ...process.env, TERM: 'dumb' },
            stdio: ['pipe', 'pipe', 'pipe'],
        });

        let stdout = '';
        let stderr = '';
        let killed = false;

        const timeoutId = setTimeout(() => {
            killed = true;
            child.kill('SIGTERM');
            // Force kill after 5 seconds if still running
            setTimeout(() => child.kill('SIGKILL'), 5000);
        }, timeout);

        child.stdout?.on('data', (data) => {
            stdout += data.toString();
            // Truncate if too long
            if (stdout.length > MAX_OUTPUT_LENGTH) {
                stdout = stdout.substring(0, MAX_OUTPUT_LENGTH) + '\n... (output truncated)';
                child.kill('SIGTERM');
            }
        });

        child.stderr?.on('data', (data) => {
            stderr += data.toString();
            if (stderr.length > MAX_OUTPUT_LENGTH) {
                stderr = stderr.substring(0, MAX_OUTPUT_LENGTH) + '\n... (output truncated)';
            }
        });

        child.on('close', (code, signal) => {
            clearTimeout(timeoutId);
            if (killed && !signal) {
                reject(new Error('Command timed out'));
            } else {
                resolve({
                    stdout: stdout.trim(),
                    stderr: stderr.trim(),
                    exitCode: code,
                    signal: signal,
                });
            }
        });

        child.on('error', (error) => {
            clearTimeout(timeoutId);
            reject(error);
        });
    });
}

const runCommandTool: ToolHandler = {
    name: 'run_command',
    safeToAutoRun: false,
    definition: {
        type: 'function',
        function: {
            name: 'run_command',
            description:
                'Execute a shell command. Use this for running tests, building projects, git commands, and other shell operations.',
            parameters: {
                type: 'object',
                properties: {
                    command: {
                        type: 'string',
                        description: 'The shell command to execute.',
                    },
                    cwd: {
                        type: 'string',
                        description:
                            'The working directory for the command. Defaults to the current directory.',
                    },
                    timeout: {
                        type: 'number',
                        description: `Timeout in milliseconds. Default is ${COMMAND_TIMEOUT_MS}ms.`,
                    },
                },
                required: ['command'],
            },
        },
    },
    async execute(args) {
        const command = args.command as string;
        const cwd = (args.cwd as string) || process.cwd();
        const timeout = (args.timeout as number) || COMMAND_TIMEOUT_MS;

        // Check for dangerous commands
        const dangerCheck = isDangerousCommand(command);
        if (dangerCheck.dangerous) {
            throw new Error(`Dangerous command detected: ${dangerCheck.reason}`);
        }

        const result = await executeCommand(command, cwd, timeout);

        // Format output
        let output = '';

        if (result.stdout) {
            output += result.stdout;
        }

        if (result.stderr) {
            if (output) output += '\n\n';
            output += `STDERR:\n${result.stderr}`;
        }

        if (result.exitCode !== 0) {
            output += `\n\nExit code: ${result.exitCode}`;
        }

        if (result.signal) {
            output += `\n\nTerminated by signal: ${result.signal}`;
        }

        return output || '(no output)';
    },
};

// Background command tool (for long-running processes)
const runBackgroundCommandTool: ToolHandler = {
    name: 'run_background_command',
    safeToAutoRun: false,
    definition: {
        type: 'function',
        function: {
            name: 'run_background_command',
            description:
                'Start a background process like a dev server. The command will run in the background.',
            parameters: {
                type: 'object',
                properties: {
                    command: {
                        type: 'string',
                        description: 'The shell command to run in the background.',
                    },
                    cwd: {
                        type: 'string',
                        description: 'The working directory for the command.',
                    },
                },
                required: ['command'],
            },
        },
    },
    async execute(args) {
        const command = args.command as string;
        const cwd = (args.cwd as string) || process.cwd();

        const dangerCheck = isDangerousCommand(command);
        if (dangerCheck.dangerous) {
            throw new Error(`Dangerous command detected: ${dangerCheck.reason}`);
        }

        const shell = process.platform === 'win32' ? 'cmd.exe' : '/bin/bash';
        const shellArgs = process.platform === 'win32' ? ['/c', command] : ['-c', command];

        const child = spawn(shell, shellArgs, {
            cwd,
            detached: true,
            stdio: 'ignore',
        });

        child.unref();

        return `Started background process with PID: ${child.pid}\nCommand: ${command}`;
    },
};

export function registerShellTools(): void {
    toolRegistry.register(runCommandTool);
    toolRegistry.register(runBackgroundCommandTool);
}
