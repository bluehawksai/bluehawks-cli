/**
 * Bluehawks CLI - Hooks Types
 * Type definitions for the hooks system
 */

export type HookEvent =
    | 'SessionStart'
    | 'UserPromptSubmit'
    | 'PreToolUse'
    | 'PostToolUse'
    | 'PostToolUseFailure'
    | 'Stop'
    | 'SessionEnd';

export interface HookContext {
    sessionId: string;
    projectPath: string;
    model: string;
    timestamp: string;
}

export interface SessionStartInput extends HookContext {
    cwd: string;
}

export interface UserPromptSubmitInput extends HookContext {
    prompt: string;
}

export interface PreToolUseInput extends HookContext {
    toolName: string;
    toolInput: Record<string, unknown>;
}

export interface PostToolUseInput extends HookContext {
    toolName: string;
    toolInput: Record<string, unknown>;
    toolOutput: string;
    duration: number;
}

export interface PostToolUseFailureInput extends HookContext {
    toolName: string;
    toolInput: Record<string, unknown>;
    error: string;
}

export interface StopInput extends HookContext {
    reason: 'completed' | 'cancelled' | 'error';
    messageCount: number;
}

export interface SessionEndInput extends HookContext {
    duration: number;
    tokensUsed: number;
}

export type HookInput =
    | SessionStartInput
    | UserPromptSubmitInput
    | PreToolUseInput
    | PostToolUseInput
    | PostToolUseFailureInput
    | StopInput
    | SessionEndInput;

export interface HookOutput {
    // Block the action (for Pre* hooks)
    block?: boolean;
    blockReason?: string;

    // Modify the input (for Pre* hooks)
    modifiedInput?: Record<string, unknown>;

    // Add content to the conversation
    addContent?: string;

    // Custom data to pass to the next hook
    data?: Record<string, unknown>;
}

export interface HookHandler {
    // Unique identifier for this handler
    id: string;

    // Human-readable name
    name: string;

    // Which event this hook handles
    event: HookEvent;

    // Command to execute (shell command)
    command?: string;

    // Inline handler function
    handler?: (input: HookInput) => Promise<HookOutput | void>;

    // Whether to run asynchronously (don't block)
    async?: boolean;

    // Timeout in milliseconds
    timeout?: number;

    // Matcher pattern (for tool-specific hooks)
    matcher?: string | RegExp;
}

export interface HooksConfig {
    SessionStart?: HookHandler[];
    UserPromptSubmit?: HookHandler[];
    PreToolUse?: HookHandler[];
    PostToolUse?: HookHandler[];
    PostToolUseFailure?: HookHandler[];
    Stop?: HookHandler[];
    SessionEnd?: HookHandler[];
}
