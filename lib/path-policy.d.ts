export interface MemoryPaths {
    workspaceRoot: string;
    agentDirectory: string;
    memoryFile: string;
    lockDirectory: string;
}
export declare function resolveWorkspaceRoot(workspaceRoot: string): Promise<string>;
export declare function resolveMemoryPaths(workspaceRoot: string, createAgentDirectory: boolean): Promise<MemoryPaths | undefined>;
export declare function assertSafeMemoryFile(paths: MemoryPaths): Promise<boolean>;
//# sourceMappingURL=path-policy.d.ts.map