/**
 * Bluehawks CLI - Tool Definitions Index
 * Register all tools
 */

import { registerFileTools } from './file.js';
import { registerShellTools } from './shell.js';
import { registerSearchTools } from './search.js';
import { registerGitTools } from './git.js';
import { registerWebTools } from './web.js';
import { registerMemoryTools } from './memory.js';

export function registerAllTools(): void {
    registerFileTools();
    registerShellTools();
    registerSearchTools();
    registerGitTools();
    registerWebTools();
    registerMemoryTools();
}

export * from './file.js';
export * from './shell.js';
export * from './search.js';
export * from './git.js';
export * from './web.js';
export * from './memory.js';
