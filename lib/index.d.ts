import type { Context } from '@deepseek-ai/cordis';
import { type Config as ProjectMemoryConfig } from './config.js';
export declare const name = "project-memory";
export declare const inject: string[];
export declare const Config: import("@deepseek-ai/schemastery").default<Schemastery.ObjectS<NoInfer<{
    maxMemoryBytes: import("@deepseek-ai/schemastery").default<number, number, "defined">;
    lockTimeoutMs: import("@deepseek-ai/schemastery").default<number, number, "defined">;
    staleLockMs: import("@deepseek-ai/schemastery").default<number, number, "defined">;
    requireApproval: import("@deepseek-ai/schemastery").default<boolean, boolean, "defined">;
    approvalGrowthBytes: import("@deepseek-ai/schemastery").default<number, number, "defined">;
    approvalWatermarkPercent: import("@deepseek-ai/schemastery").default<number, number, "defined">;
}>>, Schemastery.ObjectT<NoInfer<{
    maxMemoryBytes: import("@deepseek-ai/schemastery").default<number, number, "defined">;
    lockTimeoutMs: import("@deepseek-ai/schemastery").default<number, number, "defined">;
    staleLockMs: import("@deepseek-ai/schemastery").default<number, number, "defined">;
    requireApproval: import("@deepseek-ai/schemastery").default<boolean, boolean, "defined">;
    approvalGrowthBytes: import("@deepseek-ai/schemastery").default<number, number, "defined">;
    approvalWatermarkPercent: import("@deepseek-ai/schemastery").default<number, number, "defined">;
}>>, "plain">;
export type Config = ProjectMemoryConfig;
export { ProjectMemoryStore } from './memory-store.js';
export { SnapshotManager } from './snapshot-manager.js';
export { parseMemoryFile, serializeMemoryFile } from './memory-format.js';
export declare function apply(ctx: Context, config?: Partial<ProjectMemoryConfig>): void;
//# sourceMappingURL=index.d.ts.map