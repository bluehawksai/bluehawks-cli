import Database from 'better-sqlite3';
import * as path from 'path';
import * as os from 'os';
import * as fs from 'fs';
import { CONFIG_DIR_NAME } from '../../config/constants.js';
import type { Memory, MemoryType } from './types.js';

export class MemoryStorage {
    private db: Database.Database;
    private dbPath: string;

    constructor() {
        const homeDir = os.homedir();
        const configDir = path.join(homeDir, CONFIG_DIR_NAME);

        // Ensure directory exists
        if (!fs.existsSync(configDir)) {
            fs.mkdirSync(configDir, { recursive: true });
        }

        this.dbPath = path.join(configDir, 'memory.db');
        this.db = new Database(this.dbPath);
        this.initialize();
    }

    private initialize(): void {
        this.db.exec(`
            CREATE TABLE IF NOT EXISTS memories (
                id TEXT PRIMARY KEY,
                content TEXT NOT NULL,
                type TEXT NOT NULL,
                metadata TEXT,
                embedding TEXT,
                created_at INTEGER NOT NULL,
                updated_at INTEGER NOT NULL
            );
            CREATE INDEX IF NOT EXISTS idx_memories_type ON memories(type);
        `);
    }

    async save(memory: Memory): Promise<void> {
        const stmt = this.db.prepare(`
            INSERT OR REPLACE INTO memories (id, content, type, metadata, embedding, created_at, updated_at)
            VALUES (@id, @content, @type, @metadata, @embedding, @created_at, @updated_at)
        `);

        stmt.run({
            ...memory,
            metadata: JSON.stringify(memory.metadata || {}),
            embedding: JSON.stringify(memory.embedding || []),
        });
    }

    async get(id: string): Promise<Memory | null> {
        const stmt = this.db.prepare('SELECT * FROM memories WHERE id = ?');
        const row = stmt.get(id) as any;

        if (!row) return null;
        return this.mapRowToMemory(row);
    }

    async getAll(): Promise<Memory[]> {
        const stmt = this.db.prepare('SELECT * FROM memories');
        const rows = stmt.all() as any[];
        return rows.map(r => this.mapRowToMemory(r));
    }

    async delete(id: string): Promise<void> {
        const stmt = this.db.prepare('DELETE FROM memories WHERE id = ?');
        stmt.run(id);
    }

    async clear(): Promise<void> {
        this.db.exec('DELETE FROM memories');
    }

    private mapRowToMemory(row: any): Memory {
        return {
            id: row.id,
            content: row.content,
            type: row.type as MemoryType,
            metadata: JSON.parse(row.metadata),
            embedding: JSON.parse(row.embedding),
            created_at: row.created_at,
            updated_at: row.updated_at,
        };
    }
}

export const memoryStorage = new MemoryStorage();
