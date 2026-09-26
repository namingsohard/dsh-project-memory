import type { Context } from '@deepseek-ai/cordis';
import { type Config as ProjectMemoryConfig } from './config.js';
export declare const name = "project-memory";
export declare const inject: string[];
export declare const Config: import("@deepseek-ai/schemastery").default<Schemastery.ObjectS<{
    maxMemoryBytes: import("@deepseek-ai/schemastery").default<number, number>;
    lockTimeoutMs: import("@deepseek-ai/schemastery").default<number, number>;
    staleLockMs: import("@deepseek-ai/schemastery").default<number, number>;
    requireApproval: import("@deepseek-ai/schemastery").default<boolean, boolean>;
    approvalGrowthBytes: import("@deepseek-ai/schemastery").default<number, number>;
    approvalWatermarkPercent: import("@deepseek-ai/schemastery").default<number, number>;
}>, Schemastery.ObjectT<{
    maxMemoryBytes: import("@deepseek-ai/schemastery").default<number, number>;
    lockTimeoutMs: import("@deepseek-ai/schemastery").default<number, number>;
    staleLockMs: import("@deepseek-ai/schemastery").default<number, number>;
    requireApproval: import("@deepseek-ai/schemastery").default<boolean, boolean>;
    approvalGrowthBytes: import("@deepseek-ai/schemastery").default<number, number>;
    approvalWatermarkPercent: import("@deepseek-ai/schemastery").default<number, number>;
}>>;
export type Config = ProjectMemoryConfig;
export { ProjectMemoryStore } from './memory-store.js';
export { SnapshotManager } from './snapshot-manager.js';
export { parseMemoryFile, serializeMemoryFile } from './memory-format.js';
export declare function apply(ctx: Context, config?: Partial<ProjectMemoryConfig>): void;
//# sourceMappingURL=index.d.ts.map