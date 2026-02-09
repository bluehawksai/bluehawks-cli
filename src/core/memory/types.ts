export interface Memory {
    id: string;
    content: string;
    type: MemoryType;
    metadata?: Record<string, any>;
    embedding?: number[];
    created_at: number;
    updated_at: number;
}

export type MemoryType = 'preference' | 'mistake' | 'knowledge' | 'task_context';

export interface MemoryMetadata {
    source?: string;
    confidence?: number;
    tags?: string[];
    [key: string]: any;
}

export interface SearchResult extends Memory {
    similarity: number;
}
