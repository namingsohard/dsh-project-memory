import type { Context } from '@deepseek-ai/cordis';
import { Config as ConfigSchema, type Config as ProjectMemoryConfig } from './config.js';
export declare const name = "project-memory";
export declare const inject: string[];
export declare const Config: import("@deepseek-ai/schemastery").default<ConfigSchema>;
export type Config = ProjectMemoryConfig;
export { ProjectMemoryStore } from './memory-store.js';
export { SnapshotManager } from './snapshot-manager.js';
export { parseMemoryFile, serializeMemoryFile } from './memory-format.js';
export declare function apply(ctx: Context, config?: Partial<ProjectMemoryConfig>): void;
//# sourceMappingURL=index.d.ts.map