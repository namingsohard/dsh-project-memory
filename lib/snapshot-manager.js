import { ProjectMemoryError } from './errors.js';
function workspaceOf(agent) {
    const cwd = agent.session.header.cwd;
    if (cwd === undefined) {
        throw new ProjectMemoryError('WORKSPACE_REQUIRED', 'Project Memory tools require a session workspace cwd.');
    }
    return cwd;
}
function snapshotFrom(memory, surfaceGeneration, loadedBy) {
    return {
        workspaceRoot: memory.workspaceRoot,
        revision: memory.revision,
        content: memory.content,
        sourceExists: memory.exists,
        sourceLegacy: memory.legacy,
        surfaceGeneration,
        loadedBy,
    };
}
export class SnapshotManager {
    snapshots = new WeakMap();
    loads = new WeakMap();
    store;
    constructor(store) {
        this.store = store;
    }
    get(agent) {
        return this.snapshots.get(agent);
    }
    async ensure(agent, signal) {
        const current = this.snapshots.get(agent);
        const surfaceGeneration = agent.session.surface.replaceGeneration;
        if (current !== undefined && current.surfaceGeneration === surfaceGeneration)
            return current;
        const reason = current !== undefined
            ? 'surface-replacement'
            : agent.session.firstLiveSeq > 0 ? 'resume' : 'start';
        return this.enqueueLoad(agent, reason, signal);
    }
    async refresh(agent, signal) {
        return this.enqueueLoad(agent, 'explicit-refresh', signal);
    }
    async readPersistent(agent, signal) {
        return this.store.read(workspaceOf(agent), signal);
    }
    enqueueLoad(agent, loadedBy, signal) {
        const prior = this.loads.get(agent);
        const task = (prior === undefined ? Promise.resolve() : prior.catch(() => undefined))
            .then(async () => {
            signal?.throwIfAborted();
            const memory = await this.store.read(workspaceOf(agent), signal);
            const snapshot = snapshotFrom(memory, agent.session.surface.replaceGeneration, loadedBy);
            this.snapshots.set(agent, snapshot);
            return snapshot;
        });
        this.loads.set(agent, task);
        void task.finally(() => {
            if (this.loads.get(agent) === task)
                this.loads.delete(agent);
        }).catch(() => undefined);
        return task;
    }
}
//# sourceMappingURL=snapshot-manager.js.map