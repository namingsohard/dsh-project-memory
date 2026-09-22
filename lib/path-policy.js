import { lstat, mkdir, realpath } from 'node:fs/promises';
import { isAbsolute, join, relative, resolve } from 'node:path';
import { isNodeError, ProjectMemoryError } from './errors.js';
function assertContained(root, target, label) {
    const rel = relative(root, target);
    if (rel === '' || (!rel.startsWith('..') && !isAbsolute(rel)))
        return;
    throw new ProjectMemoryError('PATH_ESCAPE', `${label} resolves outside the session workspace.`);
}
async function assertPlainDirectory(path, label) {
    const stat = await lstat(path);
    if (stat.isSymbolicLink()) {
        throw new ProjectMemoryError('SYMLINK_DENIED', `${label} must not be a symbolic link.`);
    }
    if (!stat.isDirectory()) {
        throw new ProjectMemoryError('INVALID_PATH', `${label} must be a directory.`);
    }
}
export async function resolveWorkspaceRoot(workspaceRoot) {
    if (!isAbsolute(workspaceRoot)) {
        throw new ProjectMemoryError('WORKSPACE_REQUIRED', 'The session workspace path must be absolute.');
    }
    const lexical = resolve(workspaceRoot);
    await assertPlainDirectory(lexical, 'Session workspace');
    return realpath(lexical);
}
export async function resolveMemoryPaths(workspaceRoot, createAgentDirectory) {
    const canonicalRoot = await resolveWorkspaceRoot(workspaceRoot);
    const agentDirectory = join(canonicalRoot, '.agent');
    try {
        await assertPlainDirectory(agentDirectory, '.agent');
    }
    catch (error) {
        if (!isNodeError(error, 'ENOENT'))
            throw error;
        if (!createAgentDirectory)
            return undefined;
        try {
            await mkdir(agentDirectory, { recursive: false });
        }
        catch (mkdirError) {
            if (!isNodeError(mkdirError, 'EEXIST'))
                throw mkdirError;
        }
        await assertPlainDirectory(agentDirectory, '.agent');
    }
    const canonicalAgentDirectory = await realpath(agentDirectory);
    assertContained(canonicalRoot, canonicalAgentDirectory, '.agent');
    return {
        workspaceRoot: canonicalRoot,
        agentDirectory: canonicalAgentDirectory,
        memoryFile: join(canonicalAgentDirectory, 'MEMORY.md'),
        lockDirectory: join(canonicalAgentDirectory, '.project-memory.lock'),
    };
}
export async function assertSafeMemoryFile(paths) {
    try {
        const stat = await lstat(paths.memoryFile);
        if (stat.isSymbolicLink()) {
            throw new ProjectMemoryError('SYMLINK_DENIED', '.agent/MEMORY.md must not be a symbolic link.');
        }
        if (!stat.isFile()) {
            throw new ProjectMemoryError('INVALID_PATH', '.agent/MEMORY.md must be a regular file.');
        }
        const canonicalFile = await realpath(paths.memoryFile);
        assertContained(paths.workspaceRoot, canonicalFile, '.agent/MEMORY.md');
        return true;
    }
    catch (error) {
        if (isNodeError(error, 'ENOENT'))
            return false;
        throw error;
    }
}
//# sourceMappingURL=path-policy.js.map