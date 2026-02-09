/**
 * Bluehawks CLI - Tool Definitions Index
 * Register all tools
 */

import { registerFileTools } from './file.js';
import { registerShellTools } from './shell.js';
import { registerSearchTools } from './search.js';
import { registerGitTools } from './git.js';
import { registerWebTools } from './web.js';

export function registerAllTools(): void {
    registerFileTools();
    registerShellTools();
    registerSearchTools();
    registerGitTools();
    registerWebTools();
}

export * from './file.js';
export * from './shell.js';
export * from './search.js';
export * from './git.js';
export * from './web.js';
