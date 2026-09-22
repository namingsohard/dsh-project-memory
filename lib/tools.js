import { defineTool } from '@deepseek-ai/dsh-tools';
import { ProjectMemoryError } from './errors.js';
function requireAgent(exec) {
    if (exec.agent === undefined) {
        throw new ProjectMemoryError('AGENT_REQUIRED', 'Project Memory tools can only be called by a live agent.');
    }
    return exec.agent;
}
function text(value) {
    return [{ type: 'text', text: JSON.stringify(value, null, 2) }];
}
const nullableInteger = {
    oneOf: [
        { type: 'integer' },
        { type: 'null' },
    ],
};
export function registerMemoryTools(ctx, store, snapshots) {
    ctx.tools.register(defineTool({
        name: 'project_memory_read',
        description: 'Read the latest persistent Project Memory from the current workspace without changing this session\'s fixed snapshot. Use before updating or when checking whether another session changed memory.',
        parameters: {},
        output: {
            schema: {
                type: 'object',
                additionalProperties: false,
                properties: {
                    persistent_revision: { type: 'integer' },
                    snapshot_revision: nullableInteger,
                    is_snapshot_stale: { type: 'boolean' },
                    exists: { type: 'boolean' },
                    legacy: { type: 'boolean' },
                    content: { type: 'string' },
                },
            },
            render: (_args, value) => text(value),
        },
        isConcurrencySafe: () => true,
        async execute(_args, exec) {
            const agent = requireAgent(exec);
            const memory = await snapshots.readPersistent(agent, exec.signal);
            const snapshot = snapshots.get(agent);
            return {
                persistent_revision: memory.revision,
                snapshot_revision: snapshot?.revision ?? null,
                is_snapshot_stale: snapshot === undefined || snapshot.revision !== memory.revision,
                exists: memory.exists,
                legacy: memory.legacy,
                content: memory.content,
            };
        },
    }));
    ctx.tools.register(defineTool({
        name: 'project_memory_write',
        description: 'The only write path for this workspace\'s persistent Project Memory, and the tool that creates it: base_revision 0 writes a workspace\'s first revision. Call it only when the session established durable, project-level knowledge a later session would otherwise have to rediscover; otherwise leave the file alone. Send the complete Markdown body with base_revision from the latest project_memory_read, kept as one current page with stale entries rewritten or deleted. A longer write may be held for the user\'s approval. A rejection indicates your addition/change is unfit for retention or overly lengthy. Assess its eligibility: if worthy but too long, shorten and resubmit; otherwise, do not rework for resubmission. Updating persistent memory does not change this session\'s snapshot.',
        parameters: {
            base_revision: {
                type: 'integer',
                required: true,
                description: 'Revision returned by the latest project_memory_read call; 0 creates the profile when this workspace has none yet.',
            },
            content: {
                type: 'string',
                required: true,
                description: 'The complete Markdown body: the whole profile as it should read now, without revision frontmatter.',
            },
            reason: {
                type: 'string',
                description: 'Short note on why this revision is worth writing; shown to the user when the write needs approval, and never stored in MEMORY.md.',
            },
        },
        output: {
            schema: {
                type: 'object',
                additionalProperties: false,
                properties: {
                    status: { type: 'string', enum: ['updated', 'unchanged', 'conflict'] },
                    previous_revision: { type: 'integer' },
                    persistent_revision: { type: 'integer' },
                    snapshot_revision: nullableInteger,
                    content: { type: 'string' },
                },
            },
            render: (_args, value) => text(value),
        },
        isConcurrencySafe: () => false,
        async execute(args, exec) {
            const agent = requireAgent(exec);
            const workspaceRoot = agent.session.header.cwd;
            if (workspaceRoot === undefined) {
                throw new ProjectMemoryError('WORKSPACE_REQUIRED', 'Project Memory tools require a session workspace cwd.');
            }
            const result = await store.update(workspaceRoot, {
                baseRevision: args.base_revision,
                content: args.content,
                ...(args.reason === undefined ? {} : { reason: args.reason }),
            }, exec.signal);
            return {
                status: result.status,
                previous_revision: result.previousRevision,
                persistent_revision: result.memory.revision,
                snapshot_revision: snapshots.get(agent)?.revision ?? null,
                content: result.memory.content,
            };
        },
    }));
    ctx.tools.register(defineTool({
        name: 'project_memory_refresh',
        description: 'Replace this session\'s fixed Project Memory snapshot with the latest persistent memory. The refreshed snapshot is used by the next model step.',
        parameters: {},
        output: {
            schema: {
                type: 'object',
                additionalProperties: false,
                properties: {
                    previous_revision: nullableInteger,
                    snapshot_revision: { type: 'integer' },
                    changed: { type: 'boolean' },
                    content: { type: 'string' },
                },
            },
            render: (_args, value) => text(value),
        },
        isConcurrencySafe: () => false,
        async execute(_args, exec) {
            const agent = requireAgent(exec);
            const previous = snapshots.get(agent);
            const snapshot = await snapshots.refresh(agent, exec.signal);
            return {
                previous_revision: previous?.revision ?? null,
                snapshot_revision: snapshot.revision,
                changed: previous === undefined || previous.revision !== snapshot.revision || previous.content !== snapshot.content,
                content: snapshot.content,
            };
        },
    }));
}
//# sourceMappingURL=tools.js.map