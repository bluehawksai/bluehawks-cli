/**
 * Bluehawks CLI - Session Storage
 * Manages named sessions and session history
 */

import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';

export interface StoredSession {
    id: string;
    name: string;
    startTime: string;
    lastAccessTime: string;
    projectPath: string;
    model: string;
    messageCount: number;
    preview: string;
}

export interface SessionIndex {
    lastSessionId: string | null;
    sessions: Record<string, StoredSession>;
}

const SESSIONS_DIR = path.join(os.homedir(), '.bluehawks', 'sessions');
const INDEX_FILE = 'index.json';

export class SessionStorage {
    private indexPath: string;
    private sessionsDir: string;

    constructor() {
        this.sessionsDir = SESSIONS_DIR;
        this.indexPath = path.join(SESSIONS_DIR, INDEX_FILE);
    }

    async ensureDir(): Promise<void> {
        await fs.mkdir(this.sessionsDir, { recursive: true });
    }

    async getIndex(): Promise<SessionIndex> {
        try {
            const content = await fs.readFile(this.indexPath, 'utf-8');
            return JSON.parse(content);
        } catch {
            return { lastSessionId: null, sessions: {} };
        }
    }

    async saveIndex(index: SessionIndex): Promise<void> {
        await this.ensureDir();
        await fs.writeFile(this.indexPath, JSON.stringify(index, null, 2));
    }

    async saveSession(
        sessionId: string,
        name: string | null,
        data: unknown,
        metadata: { projectPath: string; model: string; messageCount: number; preview: string }
    ): Promise<void> {
        await this.ensureDir();

        // Save session data
        const sessionFile = path.join(this.sessionsDir, `${sessionId}.json`);
        await fs.writeFile(sessionFile, JSON.stringify(data, null, 2));

        // Update index
        const index = await this.getIndex();
        const storedSession: StoredSession = {
            id: sessionId,
            name: name || sessionId,
            startTime: index.sessions[sessionId]?.startTime || new Date().toISOString(),
            lastAccessTime: new Date().toISOString(),
            projectPath: metadata.projectPath,
            model: metadata.model,
            messageCount: metadata.messageCount,
            preview: metadata.preview,
        };

        index.sessions[sessionId] = storedSession;
        index.lastSessionId = sessionId;
        await this.saveIndex(index);
    }

    async loadSession(sessionIdOrName: string): Promise<unknown | null> {
        const index = await this.getIndex();

        // Try to find by ID first
        let sessionId = sessionIdOrName;

        // If not found by ID, search by name
        if (!index.sessions[sessionIdOrName]) {
            const found = Object.values(index.sessions).find(
                (s) => s.name.toLowerCase() === sessionIdOrName.toLowerCase()
            );
            if (found) {
                sessionId = found.id;
            } else {
                return null;
            }
        }

        try {
            const sessionFile = path.join(this.sessionsDir, `${sessionId}.json`);
            const content = await fs.readFile(sessionFile, 'utf-8');
            return JSON.parse(content);
        } catch {
            return null;
        }
    }

    async loadLastSession(): Promise<{ id: string; data: unknown } | null> {
        const index = await this.getIndex();
        if (!index.lastSessionId) {
            return null;
        }

        const data = await this.loadSession(index.lastSessionId);
        return data ? { id: index.lastSessionId, data } : null;
    }

    async listSessions(limit = 10): Promise<StoredSession[]> {
        const index = await this.getIndex();
        return Object.values(index.sessions)
            .sort((a, b) => new Date(b.lastAccessTime).getTime() - new Date(a.lastAccessTime).getTime())
            .slice(0, limit);
    }

    async deleteSession(sessionIdOrName: string): Promise<boolean> {
        const index = await this.getIndex();

        let sessionId = sessionIdOrName;
        if (!index.sessions[sessionIdOrName]) {
            const found = Object.values(index.sessions).find(
                (s) => s.name.toLowerCase() === sessionIdOrName.toLowerCase()
            );
            if (found) {
                sessionId = found.id;
            } else {
                return false;
            }
        }

        try {
            const sessionFile = path.join(this.sessionsDir, `${sessionId}.json`);
            await fs.unlink(sessionFile);
            delete index.sessions[sessionId];
            if (index.lastSessionId === sessionId) {
                index.lastSessionId = null;
            }
            await this.saveIndex(index);
            return true;
        } catch {
            return false;
        }
    }

    async renameSession(sessionIdOrName: string, newName: string): Promise<boolean> {
        const index = await this.getIndex();

        let sessionId = sessionIdOrName;
        if (!index.sessions[sessionIdOrName]) {
            const found = Object.values(index.sessions).find(
                (s) => s.name.toLowerCase() === sessionIdOrName.toLowerCase()
            );
            if (found) {
                sessionId = found.id;
            } else {
                return false;
            }
        }

        if (index.sessions[sessionId]) {
            index.sessions[sessionId].name = newName;
            await this.saveIndex(index);
            return true;
        }

        return false;
    }
}

export const sessionStorage = new SessionStorage();
