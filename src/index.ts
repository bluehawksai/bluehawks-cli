#!/usr/bin/env node
/**
 * Bluehawks CLI - Entry Point
 * A production-ready multi-agent AI CLI assistant
 */

import { program } from 'commander';
import { render } from 'ink';
import React from 'react';
import { App } from './cli/app.js';
import { CLI_NAME, CLI_VERSION, CLI_DESCRIPTION, API_BASE_URL, DEFAULT_MODEL } from './config/constants.js';
import { APIClient } from './core/api/client.js';
import { Orchestrator } from './core/agents/orchestrator.js';
import { ToolExecutor, registerAllTools, toolRegistry } from './core/tools/index.js';
import { type SessionStats } from './core/session/manager.js';
import chalk from 'chalk';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';

// Load configuration from ~/.bluehawks/.env
function loadConfig() {
    const envPath = path.join(os.homedir(), '.bluehawks', '.env');
    try {
        const content = fs.readFileSync(envPath, 'utf-8');
        for (const line of content.split('\n')) {
            const match = line.match(/^([^#=]+)=(.*)$/);
            if (match) {
                const [, key, value] = match;
                const trimmedKey = key.trim();
                const trimmedValue = value.trim().replace(/^['"]|['"]$/g, '');
                if (!process.env[trimmedKey]) {
                    process.env[trimmedKey] = trimmedValue;
                }
            }
        }
    } catch {
        // No config file, that's fine
    }
}

// Load config before anything else
loadConfig();

// Headless mode execution
interface HeadlessOptions {
    json?: boolean;
    apiKey?: string;
    maxTurns?: number;
    systemPrompt?: string;
    appendSystemPrompt?: string;
    outputFormat?: 'text' | 'json' | 'stream-json';
    continueSession?: boolean;
    resumeSession?: string;
}

async function runHeadless(prompt: string, options: HeadlessOptions) {
    const apiClient = new APIClient({ apiKey: options.apiKey });
    const toolExecutor = new ToolExecutor({ approvalMode: 'never' }); // Auto-approve in headless
    registerAllTools();

    const orchestrator = new Orchestrator({
        projectPath: process.cwd(),
        apiClient,
        toolExecutor,
        maxTurns: options.maxTurns,
        systemPrompt: options.systemPrompt,
        appendSystemPrompt: options.appendSystemPrompt,
    });

    await orchestrator.initialize();

    // Handle session continuation
    if (options.continueSession || options.resumeSession) {
        const { sessionStorage } = await import('./core/session/storage.js');
        const session = options.resumeSession
            ? await sessionStorage.loadSession(options.resumeSession)
            : await sessionStorage.loadLastSession();

        if (session) {
            // Restore session messages to orchestrator
            // This would require extending orchestrator to accept initial messages
            console.error(`📂 Resuming session...`);
        }
    }


    // Track if we're inside <think> tags to filter them out
    let inThinkBlock = false;
    let thinkBuffer = '';

    try {
        const response = await orchestrator.chat(prompt, [], {
            onChunk: options.json ? undefined : (chunk) => {
                // Filter out <think>...</think> blocks for cleaner output
                const fullText = thinkBuffer + chunk;
                thinkBuffer = '';

                let output = '';
                let i = 0;
                while (i < fullText.length) {
                    if (!inThinkBlock) {
                        const thinkStart = fullText.indexOf('<think>', i);
                        if (thinkStart === -1) {
                            output += fullText.substring(i);
                            break;
                        } else {
                            output += fullText.substring(i, thinkStart);
                            inThinkBlock = true;
                            i = thinkStart + 7;
                        }
                    } else {
                        const thinkEnd = fullText.indexOf('</think>', i);
                        if (thinkEnd === -1) {
                            // Think block continues, buffer the rest
                            thinkBuffer = fullText.substring(i);
                            break;
                        } else {
                            inThinkBlock = false;
                            i = thinkEnd + 8;
                        }
                    }
                }
                if (output.trim()) {
                    process.stdout.write(output);
                }
            },
        });

        // Strip think blocks from final content for JSON output
        const cleanContent = response.content.replace(/<think>[\s\S]*?<\/think>/g, '').trim();

        if (options.json) {
            console.log(JSON.stringify({
                success: true,
                content: cleanContent,
                toolsUsed: response.toolsUsed,
                iterations: response.iterations,
            }, null, 2));
        } else {
            console.log(); // New line after streaming
        }

        process.exit(0);
    } catch (error) {
        if (options.json) {
            console.log(JSON.stringify({
                success: false,
                error: error instanceof Error ? error.message : String(error),
            }, null, 2));
        } else {
            console.error('Error:', error instanceof Error ? error.message : String(error));
        }
        process.exit(1);
    }
}

function printSummary(stats: SessionStats, sessionId: string) {
    const totalTools = stats.successfulToolCalls + stats.failedToolCalls;
    const successRate = totalTools > 0
        ? ((stats.successfulToolCalls / totalTools) * 100).toFixed(1)
        : '0.0';

    const formatTime = (ms: number) => {
        if (ms < 1000) return `${ms}ms`;
        return `${(ms / 1000).toFixed(1)}s`;
    };

    const wallTime = formatTime(stats.duration);
    const apiTime = formatTime(stats.apiTime);
    const toolTime = formatTime(stats.toolTime);
    const activeTime = formatTime(stats.apiTime + stats.toolTime);

    const apiPct = stats.duration > 0 ? ((stats.apiTime / stats.duration) * 100).toFixed(1) : '0.0';
    const toolPct = stats.duration > 0 ? ((stats.toolTime / stats.duration) * 100).toFixed(1) : '0.0';

    const width = 76;
    const drawLine = () => console.log(chalk.gray('  ╭' + '─'.repeat(width) + '╮'));
    const drawBottom = () => console.log(chalk.gray('  ╰' + '─'.repeat(width) + '╯'));
    const drawRow = (content: string) => {
        const plainLength = stripAnsi(content).length;
        const padding = width - plainLength - 4;
        console.log(chalk.gray('  │  ') + content + ' '.repeat(Math.max(0, padding)) + chalk.gray('  │'));
    };

    console.log();
    drawLine();
    drawRow(chalk.magenta('Agent powering down. Goodbye!'));
    drawRow('');
    drawRow(chalk.bold('Interaction Summary'));
    drawRow(`${chalk.gray('Session ID:')}       ${chalk.white(sessionId)}`);
    drawRow(`${chalk.gray('Tool Calls:')}       ${chalk.white(totalTools)} ( ${chalk.green('✓ ' + stats.successfulToolCalls)} x ${chalk.red('x ' + stats.failedToolCalls)} )`);
    drawRow(`${chalk.gray('Success Rate:')}     ${chalk.white(successRate + '%')}`);
    drawRow('');
    drawRow(chalk.bold('Performance'));
    drawRow(`${chalk.gray('Wall Time:')}        ${chalk.white(wallTime)}`);
    drawRow(`${chalk.gray('Agent Active:')}     ${chalk.white(activeTime)}`);
    drawRow(`  ${chalk.gray('» API Time:')}      ${chalk.white(apiTime.padEnd(8))} ${chalk.gray('(' + apiPct + '%)')}`);
    drawRow(`  ${chalk.gray('» Tool Time:')}     ${chalk.white(toolTime.padEnd(8))} ${chalk.gray('(' + toolPct + '%)')}`);
    drawBottom();
    console.log();
}

function stripAnsi(str: string) {
    return str.replace(/[\u001b\u009b][[()#;?]*(?:[0-9]{1,4}(?:;[0-9]{0,4})*)?[0-9A-ORZcf-nqry=><]/g, '');
}

// Configure CLI
program
    .name(CLI_NAME)
    .version(CLI_VERSION)
    .description(CLI_DESCRIPTION);

// Main command (interactive mode)
program
    .option('-p, --prompt <text>', 'Run in headless mode with the given prompt')
    .option('-j, --json', 'Output response as JSON (headless mode only)')
    .option('-k, --api-key <key>', 'API key for authentication')
    .option('--yolo', 'Enable YOLO mode (auto-approve all tool executions)')
    .option('--plan', 'Enable plan mode (create plan before execution)')
    .option('-c, --continue', 'Continue the most recent session')
    .option('-r, --resume <session>', 'Resume a specific named session')
    .option('--max-turns <n>', 'Maximum number of agentic iterations', parseInt)
    .option('--system-prompt <text>', 'Override the system prompt')
    .option('--append-system-prompt <text>', 'Append to the default system prompt')
    .option('--add-dir <dirs...>', 'Additional directories to include in context')
    .option('--output-format <format>', 'Output format: text, json, stream-json', 'text')
    .action(async (options) => {

        // Headless mode
        if (options.prompt) {
            await runHeadless(options.prompt, {
                json: options.json || options.outputFormat === 'json',
                apiKey: options.apiKey,
                maxTurns: options.maxTurns,
                systemPrompt: options.systemPrompt,
                appendSystemPrompt: options.appendSystemPrompt,
                outputFormat: options.outputFormat,
                continueSession: options.continue,
                resumeSession: options.resume,
            });
            return;
        }


        // Interactive mode
        let finalStats: SessionStats | null = null;
        let finalSessionId: string | null = null;

        const { waitUntilExit } = render(
            React.createElement(App, {
                apiKey: options.apiKey,
                yoloMode: options.yolo,
                onExit: (stats: SessionStats, sid: string) => {
                    console.log('DEBUG: index.ts onExit received stats');
                    finalStats = stats;
                    finalSessionId = sid;
                },
            })
        );

        await waitUntilExit();
        console.log('DEBUG: waitUntilExit resolved', { hasStats: !!finalStats });

        if (finalStats && finalSessionId) {
            printSummary(finalStats, finalSessionId);
        }
    });

// Config command (show only)
program
    .command('config')
    .description('Show current configuration')
    .action(() => {
        console.log('\n📋 Current Configuration:');
        console.log(`   API URL:  ${process.env.BLUEHAWKS_API_URL || API_BASE_URL}`);
        console.log(`   Model:    ${process.env.BLUEHAWKS_MODEL || DEFAULT_MODEL}`);
        console.log(`   API Key:  ${process.env.BLUEHAWKS_API_KEY ? '***set***' : 'not set'}\n`);
        console.log('Environment Variables:');
        console.log('   BLUEHAWKS_API_URL  - Override API endpoint');
        console.log('   BLUEHAWKS_API_KEY  - API key for authentication');
        console.log('   BLUEHAWKS_MODEL    - Override model name\n');
        console.log('Run `bluehawks configure` to set up your API key.\n');
    });

// Configure command (interactive setup)
program
    .command('configure')
    .description('Interactive setup for API key and settings')
    .action(async () => {
        const readline = await import('node:readline');
        const fs = await import('node:fs/promises');
        const path = await import('node:path');
        const os = await import('node:os');

        const rl = readline.createInterface({
            input: process.stdin,
            output: process.stdout,
        });

        const question = (prompt: string): Promise<string> => {
            return new Promise((resolve) => {
                rl.question(prompt, resolve);
            });
        };

        console.log('\n🦅 Bluehawks Configuration\n');
        console.log('This will save your settings to ~/.bluehawks/.env\n');

        // Get current values
        const currentApiKey = process.env.BLUEHAWKS_API_KEY || '';
        const currentUrl = process.env.BLUEHAWKS_API_URL || API_BASE_URL;
        const currentModel = process.env.BLUEHAWKS_MODEL || DEFAULT_MODEL;

        // Prompt for API key
        const apiKeyPrompt = currentApiKey
            ? `API Key [${currentApiKey.substring(0, 8)}...]: `
            : 'API Key: ';
        const apiKey = await question(apiKeyPrompt) || currentApiKey;

        // Prompt for API URL (optional)
        const urlPrompt = `API URL [${currentUrl}]: `;
        const apiUrl = await question(urlPrompt) || currentUrl;

        // Prompt for Model (optional)
        const modelPrompt = `Model [${currentModel}]: `;
        const model = await question(modelPrompt) || currentModel;

        rl.close();

        // Create config directory
        const configDir = path.join(os.homedir(), '.bluehawks');
        await fs.mkdir(configDir, { recursive: true });

        // Write .env file
        const envPath = path.join(configDir, '.env');
        const envContent = [
            `# Bluehawks CLI Configuration`,
            `BLUEHAWKS_API_KEY=${apiKey}`,
            `BLUEHAWKS_API_URL=${apiUrl}`,
            `BLUEHAWKS_MODEL=${model}`,
        ].join('\n');

        await fs.writeFile(envPath, envContent, 'utf-8');

        console.log(`\n✅ Configuration saved to ${envPath}`);
        console.log('\nTo use this configuration, add this to your shell profile:');
        console.log(`   source ~/.bluehawks/.env\n`);
        console.log('Or export variables manually:');
        console.log(`   export BLUEHAWKS_API_KEY="${apiKey}"\n`);
    });

// Tools command
program
    .command('tools')
    .description('List available tools')
    .action(() => {
        registerAllTools();
        const tools = toolRegistry.getAll();

        console.log('\n🔧 Available Tools:\n');
        for (const tool of tools) {
            const desc = tool.definition.function.description;
            const safe = tool.safeToAutoRun ? '✓ safe' : '⚠ requires approval';
            console.log(`  ${tool.name}`);
            console.log(`    ${desc.substring(0, 80)}${desc.length > 80 ? '...' : ''}`);
            console.log(`    ${safe}\n`);
        }
    });

// Sessions command
program
    .command('sessions')
    .description('List and manage saved sessions')
    .option('-d, --delete <session>', 'Delete a session')
    .action(async (options) => {
        const { sessionStorage } = await import('./core/session/storage.js');

        if (options.delete) {
            const success = await sessionStorage.deleteSession(options.delete);
            console.log(success ? `✅ Deleted: ${options.delete}` : `❌ Not found: ${options.delete}`);
            return;
        }

        const sessions = await sessionStorage.listSessions(20);
        if (sessions.length === 0) {
            console.log('\n📂 No saved sessions.\n');
            return;
        }

        console.log('\n📂 Saved Sessions:\n');
        for (const s of sessions) {
            const date = new Date(s.lastAccessTime).toLocaleDateString();
            console.log(`  ${s.name} (${s.messageCount} msgs) - ${date}`);
        }
        console.log();
    });

// Plugins command
program
    .command('plugins')
    .description('List and manage plugins')
    .option('-r, --reload', 'Reload all plugins')
    .option('-i, --info <name>', 'Show details about a plugin')
    .action(async (options) => {
        const { pluginLoader } = await import('./core/plugins/index.js');

        if (options.reload) {
            pluginLoader.unloadAll();
            await pluginLoader.loadAll();
            console.log('✅ Plugins reloaded');
            return;
        }

        if (options.info) {
            const plugin = pluginLoader.getPlugin(options.info);
            if (!plugin) {
                console.log(`❌ Plugin not found: ${options.info}`);
                return;
            }
            console.log(`\n📦 ${plugin.manifest.name} v${plugin.manifest.version}`);
            console.log(`   ${plugin.manifest.description || ''}`);
            console.log(`   Path: ${plugin.path}`);
            if (plugin.commands.size > 0) {
                console.log(`   Commands: ${Array.from(plugin.commands.keys()).join(', ')}`);
            }
            if (plugin.tools.size > 0) {
                console.log(`   Tools: ${Array.from(plugin.tools.keys()).join(', ')}`);
            }
            if (plugin.agents.size > 0) {
                console.log(`   Agents: ${Array.from(plugin.agents.keys()).join(', ')}`);
            }
            console.log();
            return;
        }

        // List plugins
        const plugins = pluginLoader.getPlugins();
        if (plugins.length === 0) {
            console.log('\n📦 No plugins installed.\n');
            console.log('To install plugins, create a directory at:');
            console.log('  ~/.bluehawks/plugins/<plugin-name>/plugin.json\n');
            return;
        }

        console.log('\n📦 Installed Plugins:\n');
        for (const plugin of plugins) {
            console.log(`  ${plugin.manifest.name} v${plugin.manifest.version}`);
            if (plugin.manifest.description) {
                console.log(`    ${plugin.manifest.description}`);
            }
        }
        console.log();
    });

// Version info
program
    .command('version')
    .description('Show version information')
    .action(() => {
        console.log(`\n🦅 ${CLI_NAME}`);
        console.log(`   Version: ${CLI_VERSION}`);
        console.log(`   Node.js: ${process.version}`);
        console.log(`   Platform: ${process.platform} ${process.arch}\n`);
    });

// Parse arguments
program.parse();
