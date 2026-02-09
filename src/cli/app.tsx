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
    <Box flexDirection="column" marginY={1}>
        <Text color="#3B82F6">{"██████╗ ██╗     ██╗   ██╗███████╗██╗  ██╗ █████╗ ██╗    ██╗██╗  ██╗███████╗"}</Text>
        <Text color="#6366F1">{"██╔══██╗██║     ██║   ██║██╔════╝██║  ██║██╔══██╗██║    ██║██║ ██╔╝██╔════╝"}</Text>
        <Text color="#8B5CF6">{"██████╔╝██║     ██║   ██║█████╗  ███████║███████║██║ █╗ ██║█████╔╝ ███████╗"}</Text>
        <Text color="#A855F7">{"██╔══██╗██║     ██║   ██║██╔══╝  ██╔══██║██╔══██║██║███╗██║██╔═██╗ ╚════██║"}</Text>
        <Text color="#D946EF">{"██████╔╝███████╗╚██████╔╝███████╗██║  ██║██║  ██║╚███╔███╔╝██║  ██╗███████║"}</Text>
        <Text color="#EC4899">{"╚═════╝ ╚══════╝ ╚═════╝ ╚══════╝╚═╝  ╚═╝╚═╝  ╚═╝ ╚══╝╚══╝ ╚═╝  ╚═╝╚══════╝"}</Text>
    </Box>
);

const HeaderBox: React.FC<{ version: string; model: string; projectPath: string }> = ({ version, model, projectPath }) => {
    const relativePath = projectPath.startsWith(os.homedir())
        ? '~/' + path.relative(os.homedir(), projectPath)
        : projectPath;

    return (
        <Box borderStyle="round" borderColor="#3B82F6" paddingX={2} paddingY={0} width={80} marginBottom={1}>
            <Box flexDirection="column">
                <Box>
                    <Text bold color="#3B82F6">{">_ "}{CLI_NAME} </Text>
                    <Text color="gray">(v{version})</Text>
                </Box>
                <Box marginTop={0}>
                    <Text color="gray">Model: </Text>
                    <Text color="white">{model}</Text>
                </Box>
                <Box>
                    <Text color="gray">Path:  </Text>
                    <Text color="white">{relativePath}</Text>
                </Box>
            </Box>
        </Box>
    );
};

const Tips = () => {
    const tipsList = [
        "Start a fresh idea with /clear or /new; the previous session stays available in history.",
        "Use /yolo to auto-approve all tool executions for maximum speed.",
        "Need help? Type /help to see all available commands and shortcuts.",
        "Bluehawks can read your codebase, run tests, and even commit changes.",
        "Working on a specific repository? Bluehawks understands your local context automatically."
    ];
    const [tip] = useState(() => tipsList[Math.floor(Math.random() * tipsList.length)]);

    return (
        <Box marginTop={1} marginBottom={1}>
            <Text color="gray">Tips: {tip}</Text>
        </Box>
    );
};

const StatusBar: React.FC<{ isYoloMode: boolean }> = ({ isYoloMode }) => (
    <Box marginTop={1} paddingX={1} borderStyle="single" borderTop={true} borderBottom={false} borderLeft={false} borderRight={false} borderColor="gray">
        <Box flexGrow={1}>
            {/* Usage tips simplified as they are now at top when empty */}
            <Text color="gray">Type </Text>
            <Text color="cyan" bold>/help</Text>
            <Text color="gray"> for commands. </Text>
        </Box>
        {isYoloMode && (
            <Box>
                <Text color="#F59E0B" bold>⚡ YOLO MODE ACTIVE </Text>
            </Box>
        )}
    </Box>
);


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
                                ? '⚡ YOLO mode enabled! All tools will auto-execute.'
                                : '🛡️ YOLO mode disabled. Dangerous tools will require approval.',
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
        <Box flexDirection="column" paddingX={2} paddingY={1}>
            {/* Branding & Header */}
            <Box flexDirection="row" alignItems="center" marginBottom={1}>
                <Branding />
                <Box marginLeft={4}>
                    <HeaderBox
                        version={CLI_VERSION}
                        model={apiClient.currentModel}
                        projectPath={process.cwd()}
                    />
                </Box>
            </Box>

            {/* Tips only shown on start */}
            {messages.length === 0 && <Tips />}

            {/* Messages */}
            <Box flexDirection="column" flexGrow={1} marginBottom={1}>
                {messages.slice(-30).map((msg, i) => {
                    // Custom rendering for Tool messages (Boxed UI)
                    if (msg.role === 'tool') {
                        try {
                            const content = JSON.parse(msg.content);
                            if (content.type === 'tool_start') {
                                return (
                                    <Box key={i} flexDirection="column" borderStyle="round" borderColor="magenta" paddingX={1} marginY={1}>
                                        <Box>
                                            <Text color="magenta" bold>⚡ TOOL CALL: </Text>
                                            <Text color="white" bold>{content.name}</Text>
                                        </Box>
                                        <Box marginLeft={2}>
                                            <Text color="gray">{JSON.stringify(content.args, null, 2)}</Text>
                                        </Box>
                                    </Box>
                                );
                            } else if (content.type === 'tool_end') {
                                return (
                                    <Box key={i} flexDirection="column" borderStyle="round" borderColor="green" paddingX={1} marginBottom={1}>
                                        <Box>
                                            <Text color="green" bold>✅ TOOL RESULT: </Text>
                                            <Text color="white" bold>{content.name}</Text>
                                        </Box>
                                        <Box marginLeft={2}>
                                            <Text color="gray">{content.result ? content.result.substring(0, 200) + (content.result.length > 200 ? '...' : '') : 'Completed'}</Text>
                                        </Box>
                                    </Box>
                                );
                            }
                        } catch {
                            // Fallback for legacy plain text tool messages
                            return (
                                <Box key={i} marginBottom={1}>
                                    <Text color="gray">🔧 {msg.content}</Text>
                                </Box>
                            );
                        }
                    }

                    // Standard User/Assistant/System messages
                    return (
                        <Box key={i} marginBottom={1} flexDirection="column">
                            <Box>
                                <Text bold color={getRoleColor(msg.role)}>
                                    {msg.role === 'user' ? '👤 YOU ' : msg.role === 'assistant' ? '🦅 BLUEHAWKS ' : 'ℹ️ SYSTEM '}
                                </Text>
                            </Box>
                            <Box marginLeft={2}>
                                <Text color="white">
                                    {msg.content}
                                </Text>
                            </Box>
                        </Box>
                    );
                })}

                {/* Streaming content */}
                {streamingContent && (
                    <Box marginBottom={1} flexDirection="column">
                        <Box>
                            <Text bold color={COLORS.success}>🦅 BLUEHAWKS </Text>
                        </Box>
                        <Box marginLeft={2}>
                            <Text color="white">{streamingContent}</Text>
                        </Box>
                    </Box>
                )}

                {/* Current tool - Only show if NO persistent start message was added yet (prevent partial dupes) */}
                {currentTool && !messages.some(m => m.role === 'tool' && m.content.includes(currentTool) && m.content.includes('tool_start')) && (
                    <Box flexDirection="column" borderStyle="round" borderColor="magenta" paddingX={2} paddingY={1} marginY={1}>
                        <Box>
                            <Spinner type="dots" />
                            <Text color="magenta" bold> ⚡ TOOL CALL: </Text>
                            <Text color="white" bold>{currentTool}</Text>
                        </Box>
                    </Box>
                )}

                {/* Approval prompt */}
                {pendingApproval && (
                    <Box flexDirection="column" borderStyle="round" borderColor="yellow" padding={1} marginY={1}>
                        <Text color={COLORS.warning} bold>
                            ⚠️ ACTION REQUIRED: Tool Approval
                        </Text>
                        <Box marginY={1} paddingX={1} borderStyle="single" borderColor="gray">
                            <Text color="white" bold>{pendingApproval.toolName}</Text>
                            <Text color="gray">
                                {"\n"}Args: {JSON.stringify(pendingApproval.args, null, 2).substring(0, 500)}
                            </Text>
                        </Box>
                        <Box>
                            <Text>Press </Text>
                            <Text color="green" bold>Y</Text>
                            <Text> to approve, </Text>
                            <Text color="red" bold>N</Text>
                            <Text> to deny</Text>
                        </Box>
                    </Box>
                )}
            </Box>

            {/* Input Area */}
            {!pendingApproval && (
                <Box flexDirection="column">
                    <Box borderStyle="single" borderTop={true} borderBottom={false} borderLeft={false} borderRight={false} borderColor="gray" paddingTop={1}>
                        <Text color={COLORS.primary} bold>❯ </Text>
                        {isProcessing ? (
                            <Box>
                                <Spinner type="simpleDotsScrolling" />
                                <Text color={COLORS.muted}> Agent is thinking...</Text>
                            </Box>
                        ) : (
                            <TextInput
                                value={input}
                                onChange={setInput}
                                onSubmit={handleSubmit}
                                placeholder="What's on your mind?"
                            />
                        )}
                    </Box>
                    <StatusBar isYoloMode={isYoloMode} />
                </Box>
            )}
        </Box>
    );
};
