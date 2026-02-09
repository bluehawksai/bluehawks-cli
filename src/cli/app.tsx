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


interface AppProps {
    initialPrompt?: string;
    apiKey?: string;
    yoloMode?: boolean;
}

interface MessageDisplay {
    role: 'user' | 'assistant' | 'tool' | 'system' | 'error';
    content: string;
}

export const App: React.FC<AppProps> = ({ initialPrompt, apiKey, yoloMode = false }) => {
    const { exit } = useApp();
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
            const cleanup = async () => {
                const stopContext: StopInput = {
                    sessionId: sessionManager.getSessionId(),
                    projectPath: process.cwd(),
                    model: apiClient.currentModel,
                    timestamp: new Date().toISOString(),
                    reason: 'completed',
                    messageCount: sessionManager.getStats().messageCount,
                };
                await hooksManager.execute('Stop', stopContext);
                await sessionManager.save();
            };
            cleanup().catch(console.error);
        };
    }, [toolExecutor, isYoloMode, orchestrator, sessionManager, apiClient]);


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
                    onExit: () => exit(),
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
                    onToolStart: (name) => {
                        setCurrentTool(name);
                        setMessages((prev) => [
                            ...prev,
                            { role: 'tool', content: `🔧 Running: ${name}...` },
                        ]);
                    },
                    onToolEnd: (name, result) => {
                        setCurrentTool(null);
                        const truncated =
                            result.length > 500 ? result.substring(0, 500) + '...' : result;
                        setMessages((prev) => [
                            ...prev,
                            { role: 'tool', content: `✓ ${name}:\n${truncated}` },
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
        <Box flexDirection="column" padding={1}>
            {/* Header */}
            <Box marginBottom={1}>
                <Text bold color={COLORS.primary}>
                    🦅 {CLI_NAME} v{CLI_VERSION}
                </Text>
                <Text color={COLORS.muted}> | </Text>
                <Text color={COLORS.muted}>Type /help for commands</Text>
                {isYoloMode && (
                    <>
                        <Text color={COLORS.muted}> | </Text>
                        <Text color={COLORS.warning}>⚡ YOLO</Text>
                    </>
                )}
            </Box>

            {/* Messages */}
            <Box flexDirection="column" marginBottom={1}>
                {messages.slice(-20).map((msg, i) => (
                    <Box key={i} marginBottom={1}>
                        <Text color={getRoleColor(msg.role)}>
                            {msg.role === 'user' ? '› ' : msg.role === 'assistant' ? '🦅 ' : ''}
                            {msg.content}
                        </Text>
                    </Box>
                ))}

                {/* Streaming content */}
                {streamingContent && (
                    <Box marginBottom={1}>
                        <Text color={COLORS.success}>🦅 {streamingContent}</Text>
                    </Box>
                )}

                {/* Current tool */}
                {currentTool && (
                    <Box>
                        <Spinner type="dots" />
                        <Text color={COLORS.info}> Running {currentTool}...</Text>
                    </Box>
                )}

                {/* Approval prompt */}
                {pendingApproval && (
                    <Box flexDirection="column" borderStyle="round" borderColor="yellow" padding={1}>
                        <Text color={COLORS.warning}>
                            ⚠️ Tool requires approval: {pendingApproval.toolName}
                        </Text>
                        <Text color={COLORS.muted}>
                            Args: {JSON.stringify(pendingApproval.args, null, 2).substring(0, 200)}
                        </Text>
                        <Text>
                            Press <Text color="green">Y</Text> to approve, <Text color="red">N</Text> to deny
                        </Text>
                    </Box>
                )}
            </Box>

            {/* Input */}
            {!pendingApproval && (
                <Box>
                    <Text color={COLORS.primary}>› </Text>
                    {isProcessing ? (
                        <Box>
                            <Spinner type="dots" />
                            <Text color={COLORS.muted}> Thinking...</Text>
                        </Box>
                    ) : (
                        <TextInput
                            value={input}
                            onChange={setInput}
                            onSubmit={handleSubmit}
                            placeholder="Ask me anything..."
                        />
                    )}
                </Box>
            )}
        </Box>
    );
};
