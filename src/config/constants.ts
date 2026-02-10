/**
 * Bluehawks CLI - Core Constants
 */

// API Configuration
export const API_BASE_URL = 'https://api.bluehawks.ai/v1';
export const DEFAULT_MODEL = 'Qwen/Qwen3-8B';  // 8B model supports proper function calling
export const DEFAULT_EMBEDDING_MODEL = 'Qwen/Qwen3-Embedding-0.6B';
export const DEFAULT_RERANK_MODEL = 'Qwen/Qwen3-Reranker-0.6B';

// CLI Metadata
export const CLI_NAME = 'bluehawks';
export const CLI_VERSION = '1.0.37';
export const CLI_DESCRIPTION = 'A production-ready multi-agent AI CLI assistant';

// Configuration Paths
export const CONFIG_DIR_NAME = '.bluehawks';
export const SETTINGS_FILE = 'settings.json';
export const CONTEXT_FILE = 'BLUEHAWKS.md';
export const HISTORY_FILE = 'history.json';
export const ENV_FILE = '.env';

// API Defaults
export const DEFAULT_MAX_TOKENS = 4096;
export const DEFAULT_TEMPERATURE = 0.7;
export const DEFAULT_TIMEOUT_MS = 120000;
export const MAX_RETRIES = 3;
export const RETRY_DELAY_MS = 1000;

// Tool Execution
export const COMMAND_TIMEOUT_MS = 60000;
export const MAX_OUTPUT_LENGTH = 50000;
export const MAX_FILE_SIZE_BYTES = 10 * 1024 * 1024; // 10MB

// Session
export const MAX_HISTORY_MESSAGES = 100;
export const COMPRESS_THRESHOLD = 50;

// Colors (for terminal output)
export const COLORS = {
    primary: '#3B82F6',
    success: '#10B981',
    warning: '#F59E0B',
    error: '#EF4444',
    info: '#6366F1',
    muted: '#6B7280',
} as const;
