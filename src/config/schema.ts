/**
 * Bluehawks CLI - Settings Schema
 */

import { z } from 'zod';

export const settingsSchema = z.object({
    // API Settings
    apiUrl: z.string().url().optional(),
    apiKey: z.string().optional(),
    model: z.string().optional(),

    // Execution Settings
    approvalMode: z.enum(['always', 'never', 'unsafe-only']).default('unsafe-only'),
    maxTokens: z.number().min(1).max(32768).default(4096),
    temperature: z.number().min(0).max(2).default(0.7),
    timeout: z.number().min(1000).max(600000).default(120000),

    // UI Settings
    theme: z.enum(['dark', 'light', 'auto']).default('dark'),
    showTimestamps: z.boolean().default(false),
    compactMode: z.boolean().default(false),

    // Feature Flags
    planMode: z.boolean().default(false),
    mcpEnabled: z.boolean().default(false),

    // Tool Settings
    commandTimeout: z.number().min(1000).max(300000).default(60000),
    maxOutputLength: z.number().min(1000).max(100000).default(50000),
    excludePatterns: z.array(z.string()).default(['node_modules', '.git', 'dist', 'build']),
});

export type Settings = z.infer<typeof settingsSchema>;

export const defaultSettings: Settings = settingsSchema.parse({});
