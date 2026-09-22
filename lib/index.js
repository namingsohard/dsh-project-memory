import { registerMemoryApprovalGate } from './approval-gate.js';
import { Config as ConfigSchema, resolveConfig } from './config.js';
import { ProjectMemoryStore } from './memory-store.js';
import { addProjectMemorySection } from './prompt-provider.js';
import { SnapshotManager } from './snapshot-manager.js';
import { registerMemoryTools } from './tools.js';
export const name = 'project-memory';
export const inject = ['tools', 'systemPrompt'];
export const Config = ConfigSchema;
export { ProjectMemoryStore } from './memory-store.js';
export { SnapshotManager } from './snapshot-manager.js';
export { parseMemoryFile, serializeMemoryFile } from './memory-format.js';
export function apply(ctx, config) {
    const resolved = resolveConfig(config);
    const store = new ProjectMemoryStore(resolved);
    const snapshots = new SnapshotManager(store);
    registerMemoryTools(ctx, store, snapshots);
    registerMemoryApprovalGate(ctx, store, resolved);
    ctx.on('system-prompt/assemble', async (assembly, assembleContext, next) => {
        const transformed = await next();
        const agent = assembleContext.agent;
        if (agent === undefined)
            return transformed;
        assembleContext.signal?.throwIfAborted();
        try {
            const snapshot = await snapshots.ensure(agent, assembleContext.signal);
            return addProjectMemorySection(transformed, snapshot);
        }
        catch (error) {
            // Project Memory is an optional background layer. A workspace that cannot
            // be resolved, or a MEMORY.md the plugin refuses (unsafe path, bad
            // metadata, oversized body), degrades to "no memory for this assembly" so
            // the step still reaches the model. Aborts are the caller's own control
            // flow and must keep propagating.
            if (assembleContext.signal?.aborted === true)
                throw error;
            ctx.logger?.warn('project-memory: skipped memory injection for this assembly: %s', error instanceof Error ? error.message : String(error));
            return transformed;
        }
    });
}
//# sourceMappingURL=index.js.map