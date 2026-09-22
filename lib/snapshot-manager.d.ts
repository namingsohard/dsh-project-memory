import type { Agent } from '@deepseek-ai/dsh-agent';
import type { PersistentMemory, ProjectMemoryStore } from './memory-store.js';
export type SnapshotLoadReason = 'start' | 'resume' | 'explicit-refresh' | 'surface-replacement';
export interface SessionMemorySnapshot {
    workspaceRoot: string;
    revision: number;
    content: string;
    sourceExists: boolean;
    sourceLegacy: boolean;
    surfaceGeneration: number;
    loadedBy: SnapshotLoadReason;
}
export declare class SnapshotManager {
    private readonly snapshots;
    private readonly loads;
    readonly store: ProjectMemoryStore;
    constructor(store: ProjectMemoryStore);
    get(agent: Agent): SessionMemorySnapshot | undefined;
    ensure(agent: Agent, signal?: AbortSignal): Promise<SessionMemorySnapshot>;
    refresh(agent: Agent, signal?: AbortSignal): Promise<SessionMemorySnapshot>;
    readPersistent(agent: Agent, signal?: AbortSignal): Promise<PersistentMemory>;
    private enqueueLoad;
}
//# sourceMappingURL=snapshot-manager.d.ts.map