import type { Config } from './config.js';
import { MEMORY_FORMAT_VERSION } from './memory-format.js';
export interface PersistentMemory {
    workspaceRoot: string;
    revision: number;
    content: string;
    exists: boolean;
    legacy: boolean;
    format: typeof MEMORY_FORMAT_VERSION;
}
export interface MemoryUpdateRequest {
    baseRevision: number;
    content: string;
    reason?: string;
}
export type MemoryUpdateResult = {
    status: 'updated';
    previousRevision: number;
    memory: PersistentMemory;
} | {
    status: 'unchanged';
    previousRevision: number;
    memory: PersistentMemory;
} | {
    status: 'conflict';
    previousRevision: number;
    memory: PersistentMemory;
};
export declare class ProjectMemoryStore {
    readonly config: Config;
    constructor(config: Config);
    read(workspaceRoot: string, signal?: AbortSignal): Promise<PersistentMemory>;
    update(workspaceRoot: string, request: MemoryUpdateRequest, signal?: AbortSignal): Promise<MemoryUpdateResult>;
    private readAt;
    private assertContentSize;
    private withLock;
    private recoverStaleLock;
    private writeAtomic;
}
//# sourceMappingURL=memory-store.d.ts.map