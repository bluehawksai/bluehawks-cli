/**
 * Bluehawks CLI - Settings Manager
 */

import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';
import { settingsSchema, defaultSettings, type Settings } from './schema.js';
import { CONFIG_DIR_NAME, SETTINGS_FILE, ENV_FILE } from './constants.js';

export class SettingsManager {
    private globalConfigPath: string;
    private projectConfigPath: string;
    private settings: Settings;

    constructor(projectPath: string = process.cwd()) {
        this.globalConfigPath = path.join(os.homedir(), CONFIG_DIR_NAME);
        this.projectConfigPath = path.join(projectPath, CONFIG_DIR_NAME);
        this.settings = { ...defaultSettings };
    }

    async load(): Promise<Settings> {
        // Load in order of increasing precedence
        const globalSettings = await this.loadFromFile(
            path.join(this.globalConfigPath, SETTINGS_FILE)
        );
        const projectSettings = await this.loadFromFile(
            path.join(this.projectConfigPath, SETTINGS_FILE)
        );
        const envSettings = await this.loadFromEnv();

        // Merge settings
        this.settings = settingsSchema.parse({
            ...defaultSettings,
            ...globalSettings,
            ...projectSettings,
            ...envSettings,
        });

        return this.settings;
    }

    private async loadFromFile(filePath: string): Promise<Partial<Settings>> {
        try {
            const content = await fs.readFile(filePath, 'utf-8');
            return JSON.parse(content);
        } catch {
            return {};
        }
    }

    private async loadFromEnv(): Promise<Partial<Settings>> {
        // Load from .env file if exists
        const envPath = path.join(this.projectConfigPath, ENV_FILE);
        try {
            const content = await fs.readFile(envPath, 'utf-8');
            const lines = content.split('\n');
            for (const line of lines) {
                const match = line.match(/^([^=]+)=(.*)$/);
                if (match) {
                    const [, key, value] = match;
                    if (!process.env[key.trim()]) {
                        process.env[key.trim()] = value.trim().replace(/^['"]|['"]$/g, '');
                    }
                }
            }
        } catch {
            // No .env file
        }

        // Map environment variables to settings
        const settings: Partial<Settings> = {};

        if (process.env.BLUEHAWKS_API_URL) {
            settings.apiUrl = process.env.BLUEHAWKS_API_URL;
        }
        if (process.env.BLUEHAWKS_API_KEY) {
            settings.apiKey = process.env.BLUEHAWKS_API_KEY;
        }
        if (process.env.BLUEHAWKS_MODEL) {
            settings.model = process.env.BLUEHAWKS_MODEL;
        }
        if (process.env.BLUEHAWKS_MAX_TOKENS) {
            settings.maxTokens = parseInt(process.env.BLUEHAWKS_MAX_TOKENS, 10);
        }
        if (process.env.BLUEHAWKS_TEMPERATURE) {
            settings.temperature = parseFloat(process.env.BLUEHAWKS_TEMPERATURE);
        }

        return settings;
    }

    async save(scope: 'global' | 'project' = 'project'): Promise<void> {
        const configPath = scope === 'global' ? this.globalConfigPath : this.projectConfigPath;
        const filePath = path.join(configPath, SETTINGS_FILE);

        await fs.mkdir(configPath, { recursive: true });
        await fs.writeFile(filePath, JSON.stringify(this.settings, null, 2), 'utf-8');
    }

    get<K extends keyof Settings>(key: K): Settings[K] {
        return this.settings[key];
    }

    set<K extends keyof Settings>(key: K, value: Settings[K]): void {
        this.settings[key] = value;
    }

    getAll(): Settings {
        return { ...this.settings };
    }

    update(partial: Partial<Settings>): void {
        this.settings = settingsSchema.parse({
            ...this.settings,
            ...partial,
        });
    }
}

export const settingsManager = new SettingsManager();
