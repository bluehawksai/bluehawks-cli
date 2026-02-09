import { apiClient } from '../api/client.js';
import { memoryStorage } from './storage.js';
import type { Memory, MemoryType, SearchResult } from './types.js';
import * as crypto from 'crypto';

export class MemoryManager {
    private static instance: MemoryManager;

    private constructor() { }

    static getInstance(): MemoryManager {
        if (!MemoryManager.instance) {
            MemoryManager.instance = new MemoryManager();
        }
        return MemoryManager.instance;
    }

    /**
     * Store a new memory
     */
    async remember(content: string, type: MemoryType = 'knowledge', metadata: Record<string, any> = {}): Promise<Memory> {
        // Generate embedding
        let embedding: number[] = [];
        try {
            const response = await apiClient.createEmbeddings(content);
            if (response.data && response.data.length > 0) {
                embedding = response.data[0].embedding;
            }
        } catch (error) {
            console.error('Failed to generate embedding for memory:', error);
            // We still save the memory without embedding, it just won't be searchable by vector
        }

        const memory: Memory = {
            id: crypto.randomUUID(),
            content,
            type,
            metadata,
            embedding,
            created_at: Date.now(),
            updated_at: Date.now(),
        };

        await memoryStorage.save(memory);
        return memory;
    }

    /**
     * Search memories by semantic similarity
     */
    async search(query: string, limit: number = 5, minSimilarity: number = 0.7): Promise<SearchResult[]> {
        // Generate query embedding
        let queryEmbedding: number[] = [];
        try {
            const response = await apiClient.createEmbeddings(query);
            if (response.data && response.data.length > 0) {
                queryEmbedding = response.data[0].embedding;
            }
        } catch (error) {
            console.error('Failed to generate embedding for search query:', error);
            // Fallback to keyword search? For now just return empty if vector search fails
            return [];
        }

        const allMemories = await memoryStorage.getAll();

        // Calculate similarity for each memory
        const results: SearchResult[] = allMemories
            .filter(m => m.embedding && m.embedding.length > 0)
            .map(memory => {
                const similarity = this.cosineSimilarity(queryEmbedding, memory.embedding!);
                return { ...memory, similarity };
            })
            .filter(r => r.similarity >= minSimilarity)
            .sort((a, b) => b.similarity - a.similarity) // Descending
            .slice(0, limit);

        return results;
    }

    /**
     * Retrieve a memory by ID
     */
    async get(id: string): Promise<Memory | null> {
        return memoryStorage.get(id);
    }

    /**
     * Delete a memory
     */
    async forget(id: string): Promise<void> {
        await memoryStorage.delete(id);
    }

    /**
     * Clear all memories (useful for testing or reset)
     */
    async clear(): Promise<void> {
        await memoryStorage.clear();
    }

    private cosineSimilarity(vecA: number[], vecB: number[]): number {
        if (vecA.length !== vecB.length) return 0;

        let dotProduct = 0;
        let normA = 0;
        let normB = 0;

        for (let i = 0; i < vecA.length; i++) {
            dotProduct += vecA[i] * vecB[i];
            normA += vecA[i] * vecA[i];
            normB += vecB[i] * vecB[i];
        }

        if (normA === 0 || normB === 0) return 0;
        return dotProduct / (Math.sqrt(normA) * Math.sqrt(normB));
    }
}

export const memoryManager = MemoryManager.getInstance();
