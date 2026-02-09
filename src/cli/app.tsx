/**
 * Bluehawks CLI - Main Application Component
 */

import React, { useState, useCallback, useEffect } from 'react';
import { Text, Box, useInput, useApp } from 'ink';
import Spinner from 'ink-spinner';
import TextInput from 'ink-text-input';
import { APIClient } from '../core/api/client.js';
import { Orchestrator } from '../core/agents/orchestrator.js';
import { ToolExecutor, toolRegistry, registerAllTools } from '../core/tools/index.js';
import { SessionManager } from '../core/session/manager.js';
import { commandRegistry, type CommandContext } from './commands/index.js';
import { CLI_NAME, CLI_VERSION, COLORS } from '../config/constants.js';
import { hooksManager } from '../core/hooks/index.js';
import type { SessionStartInput, StopInput } from '../core/hooks/types.js';
import * as path from 'path';
import * as os from 'os';

// UI Components
const Branding = () => (
    <Box marginBottom={1}>
        <Text color="#3B82F6" bold>🦅 {CLI_NAME.toUpperCase()} AI</Text>
        <Text color="gray"> (v{CLI_VERSION})</Text>
    </Box>
);

const Footer: React.FC<{ model: string; projectPath: string }> = ({ model, projectPath }) => {
    const relativePath = projectPath.startsWith(os.homedir())
        ? '~/' + path.relative(os.homedir(), projectPath)
        : projectPath;

    return (
        <Box flexDirection="row" marginTop={0} paddingTop={0}>
            <Text color="gray">{relativePath}</Text>
            <Box flexGrow={1} />
            <Text color="gray">Auto ({model})</Text>
        </Box>
    );
};

const Tips = () => {
    const tipsList = [
        "Use /clear to reset context.",
        "Type /yolo for auto-approval.",
        "Use /help for commands.",
        "Bluehawks is context-aware."
    ];
    const [tip] = useState(() => tipsList[Math.floor(Math.random() * tipsList.length)]);

    return (
        <Box marginBottom={1}>
            <Text color="gray" dimColor>Tip: {tip}</Text>
        </Box>
    );
};

interface AppProps {
    initialPrompt?: string;
    apiKey?: string;
    yoloMode?: boolean;
    onStatusUpdate?: (stats: any) => void;
    onExit?: (stats: any, sid: string) => void;
}

interface MessageDisplay {
    role: 'user' | 'assistant' | 'tool' | 'system' | 'error';
    content: string;
}

export const App: React.FC<AppProps> = ({ initialPrompt, apiKey, yoloMode = false, onExit }) => {
    const { exit } = useApp();
    const exitCalledRef = React.useRef(false);
    const [input, setInput] = useState('');
    const [messages, setMessages] = useState<MessageDisplay[]>([]);
    const [isProcessing, setIsProcessing] = useState(false);
    const [currentTool, setCurrentTool] = useState<string | null>(null);
    const [streamingContent, setStreamingContent] = useState('');
    const [pendingApproval, setPendingApproval] = useState<{
        toolName: string;
        args: Record<string, unknown>;
        resolve: (approved: boolean) => void;
    } | null>(null);
    const [isYoloMode, setIsYoloMode] = useState(yoloMode);


    // Initialize components
    const [apiClient] = useState(() => new APIClient({ apiKey }));
    const [toolExecutor] = useState(() => {
        const executor = new ToolExecutor({
            approvalMode: yoloMode ? 'never' : 'unsafe-only',
        });
        return executor;
    });
    const [orchestrator] = useState(() => {
        registerAllTools();
        return new Orchestrator({
            projectPath: process.cwd(),
            apiClient,
            toolExecutor,
        });
    });
    const [sessionManager] = useState(
        () => new SessionManager(process.cwd(), apiClient.currentModel)
    );

    // Set up approval handler and lifecycle hooks
    useEffect(() => {
        toolExecutor.setApprovalHandler(async (toolName, args) => {
            if (isYoloMode) return true;

            return new Promise<boolean>((resolve) => {
                setPendingApproval({ toolName, args, resolve });
            });
        });

        // Initialize orchestrator and trigger SessionStart hook
        orchestrator.initialize().then(async () => {
            const hookContext: SessionStartInput = {
                sessionId: sessionManager.getSessionId(),
                projectPath: process.cwd(),
                model: apiClient.currentModel,
                timestamp: new Date().toISOString(),
                cwd: process.cwd(),
            };
            await hooksManager.execute('SessionStart', hookContext);
        }).catch((err) => {
            setMessages((prev) => [...prev, { role: 'error', content: `Init error: ${err}` }]);
        });

        // Cleanup: trigger Stop hook and auto-save session on exit
        return () => {
            // CRITICAL: Call onExit SYNCHRONOUSLY before async operations
            // This ensures stats are captured before the process exits
            if (!exitCalledRef.current && onExit) {
                exitCalledRef.current = true;
                const stats = sessionManager.getStats();
                onExit(stats, sessionManager.getSessionId());
            }

            // Async cleanup for hooks and session save (non-critical)
            const cleanup = async () => {
                const stats = sessionManager.getStats();
                const stopContext: StopInput = {
                    sessionId: sessionManager.getSessionId(),
                    projectPath: process.cwd(),
                    model: apiClient.currentModel,
                    timestamp: new Date().toISOString(),
                    reason: 'completed',
                    messageCount: stats.messageCount,
                };
                await hooksManager.execute('Stop', stopContext);
                await sessionManager.save();
            };
            cleanup().catch(console.error);
        };
    }, [toolExecutor, isYoloMode, orchestrator, sessionManager, apiClient, onExit]);


    // Handle initial prompt
    useEffect(() => {
        if (initialPrompt) {
            handleSubmit(initialPrompt);
        }
    }, []);

    const handleSubmit = useCallback(
        async (value: string) => {
            const trimmed = value.trim();
            if (!trimmed || isProcessing) return;

            // Check for slash commands
            if (commandRegistry.isCommand(trimmed)) {
                const context: CommandContext = {
                    sessionManager,
                    orchestrator,
                    toolRegistry,
                    onExit: () => {
                        // Get stats before exit and call callback
                        if (!exitCalledRef.current && onExit) {
                            exitCalledRef.current = true;
                            const stats = sessionManager.getStats();
                            console.log('DEBUG: App.tsx onExit triggered', stats.messageCount);
                            onExit(stats, sessionManager.getSessionId());
                        }
                        exit();
                    },
                };

                const result = await commandRegistry.execute(trimmed, context);
                if (result) {
                    setMessages((prev) => [...prev, { role: 'system', content: result }]);
                }
                setInput('');
                return;
            }

            // Check for YOLO toggle
            if (trimmed.toLowerCase() === '/yolo') {
                setIsYoloMode((prev) => {
                    const newValue = !prev;
                    toolExecutor.setApprovalMode(newValue ? 'never' : 'unsafe-only');
                    setMessages((prev) => [
                        ...prev,
                        {
                            role: 'system',
                            content: newValue
                                ? '⚡ YOLO mode enabled.'
                                : '🛡️ YOLO mode disabled.',
                        },
                    ]);
                    return newValue;
                });
                setInput('');
                return;
            }

            // Add user message
            setMessages((prev) => [...prev, { role: 'user', content: trimmed }]);
            setInput('');
            setIsProcessing(true);
            setStreamingContent('');

            try {
                const response = await orchestrator.chat(trimmed, [], {
                    onChunk: (chunk) => {
                        setStreamingContent((prev) => prev + chunk);
                    },
                    onToolStart: (name, args?: Record<string, unknown>) => {
                        setCurrentTool(name);
                        setMessages((prev) => [
                            ...prev,
                            {
                                role: 'tool',
                                content: JSON.stringify({ type: 'tool_start', name, args })
                            },
                        ]);
                    },
                    onToolEnd: (name, result) => {
                        setCurrentTool(null);
                        setMessages((prev) => [
                            ...prev,
                            {
                                role: 'tool',
                                content: JSON.stringify({ type: 'tool_end', name, result })
                            },
                        ]);
                    },
                });

                // Add final response
                if (response.content) {
                    setMessages((prev) => [...prev, { role: 'assistant', content: response.content }]);
                }

                // Update session
                sessionManager.addMessage({ role: 'user', content: trimmed });
                sessionManager.addMessage({ role: 'assistant', content: response.content });
                response.toolsUsed.forEach((tool) => sessionManager.addToolUsed(tool));

                // Record metrics
                sessionManager.addApiTime(response.apiTime);
                sessionManager.addToolTime(response.toolTime);
                for (let i = 0; i < response.successfulToolCalls; i++) sessionManager.recordToolCall(true);
                for (let i = 0; i < response.failedToolCalls; i++) sessionManager.recordToolCall(false);
            } catch (error) {
                const errorMessage = error instanceof Error ? error.message : String(error);
                setMessages((prev) => [...prev, { role: 'error', content: `Error: ${errorMessage}` }]);
            } finally {
                setIsProcessing(false);
                setStreamingContent('');
                setCurrentTool(null);
            }
        },
        [isProcessing, orchestrator, sessionManager, exit, toolExecutor, isYoloMode]
    );

    // Handle approval input
    useInput(
        (input, key) => {
            if (pendingApproval) {
                if (input.toLowerCase() === 'y' || key.return) {
                    pendingApproval.resolve(true);
                    setPendingApproval(null);
                } else if (input.toLowerCase() === 'n' || key.escape) {
                    pendingApproval.resolve(false);
                    setPendingApproval(null);
                }
            }
        },
        { isActive: pendingApproval !== null }
    );

    const getRoleColor = (role: MessageDisplay['role']): string => {
        switch (role) {
            case 'user':
                return COLORS.primary;
            case 'assistant':
                return COLORS.success;
            case 'tool':
                return COLORS.info;
            case 'system':
                return COLORS.warning;
            case 'error':
                return COLORS.error;
            default:
                return COLORS.muted;
        }
    };

    return (
        <Box flexDirection="column" paddingX={1} paddingY={0}>
            {/* Branding - Minimal */}
            <Branding />

            {/* Tips only shown on start */}
            {messages.length === 0 && <Tips />}

            {/* Messages */}
            <Box flexDirection="column" flexGrow={1} marginBottom={0}>
                {messages.slice(-50).map((msg, i) => {
                    // Custom rendering for Tool messages (Boxed UI)
                    if (msg.role === 'tool') {
                        try {
                            const content = JSON.parse(msg.content);
                            if (content.type === 'tool_end') {
                                return (
                                    <Box key={i} flexDirection="row" marginBottom={0}>
                                        <Text color="gray">  └─ </Text>
                                        <Text color="green">✔ {content.name}</Text>
                                        <Text color="gray" dimColor> {content.result ? `(${content.result.length} chars)` : ''}</Text>
                                    </Box>
                                );
                            }
                            return null; // Skip tool_start in history to reduce noise
                        } catch {
                            return <Box key={i}><Text color="gray">🔧 {msg.content}</Text></Box>;
                        }
                    }

                    // User Message
                    if (msg.role === 'user') {
                        return (
                            <Box key={i} marginTop={1} flexDirection="row">
                                <Text color={COLORS.primary} bold>❯ </Text>
                                <Text color="white">{msg.content}</Text>
                            </Box>
                        );
                    }

                    // Assistant/System Message
                    return (
                        <Box key={i} marginTop={0} marginBottom={0} flexDirection="column">
                            {msg.role !== 'assistant' && (
                                <Text bold color={getRoleColor(msg.role)}>
                                    {msg.role === 'error' ? '❌ ERROR' : 'ℹ️ SYSTEM'}
                                </Text>
                            )}
                            <Box marginLeft={0}>
                                <Text color="white">
                                    {msg.content}
                                </Text>
                            </Box>
                        </Box>
                    );
                })}

                {/* Streaming content */}
                {streamingContent && (
                    <Box marginTop={0} flexDirection="column">
                        <Box marginLeft={0}>
                            <Text color="white">{streamingContent}</Text>
                        </Box>
                    </Box>
                )}

                {/* Current tool - Minimal Spinner */}
                {currentTool && (
                    <Box flexDirection="row" marginY={0}>
                        <Text color="magenta">  ├─ </Text>
                        <Spinner type="dots" />
                        <Text color="magenta"> Executing {currentTool}...</Text>
                    </Box>
                )}

                {/* Approval prompt */}
                {pendingApproval && (
                    <Box flexDirection="column" borderStyle="single" borderColor="yellow" paddingX={1} marginTop={1}>
                        <Text color={COLORS.warning} bold>Action Required: {pendingApproval.toolName}</Text>
                        <Text color="white">Args: {JSON.stringify(pendingApproval.args).substring(0, 100)}...</Text>
                        <Text color="gray">[Y]es / [N]o</Text>
                    </Box>
                )}
            </Box>

            {/* Input Area - Command Bar Style */}
            {!pendingApproval && (
                <Box flexDirection="column" marginTop={1}>
                    {/* Separator Line */}
                    <Box borderStyle="single" borderTop={true} borderBottom={false} borderLeft={false} borderRight={false} borderColor="gray" marginBottom={0} />

                    <Box>
                        <Text color={COLORS.primary} bold>❯ </Text>
                        {isProcessing ? (
                            <Text color={COLORS.muted}>Thinking...</Text>
                        ) : (
                            <TextInput
                                value={input}
                                onChange={setInput}
                                onSubmit={handleSubmit}
                                placeholder="..."
                            />
                        )}
                    </Box>

                    {/* Yolo Indicator */}
                    {isYoloMode && (
                        <Box marginTop={0}>
                            <Text color="#F59E0B" bold>⚡ YOLO Mode Active</Text>
                        </Box>
                    )}
                </Box>
            )}

            {/* Footer */}
            <Box marginTop={1}>
                <Footer model={apiClient.currentModel} projectPath={process.cwd()} />
            </Box>
        </Box>
    );
};
